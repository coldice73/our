import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { createVideoRecord, updateVideoStatus, getVideosByUserId } from '../models/db.js';
import { videoQueue } from '../videoProcessor.js';
import fetch from 'node-fetch';
const router = express.Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'videos');
const thumbnailsDir = path.join(process.cwd(), 'uploads', 'thumbnails');
const ANALYSIS_SERVICE_URL = process.env.ANALYSIS_SERVICE_URL || 'http://localhost:3001';
// 确保目录存在
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(thumbnailsDir);

// 优化存储配置 - 使用内存友好的方式
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9]/g, '_');
        const extension = path.extname(file.originalname);
        const filename = `${originalName}-${uniqueSuffix}${extension}`;

        console.log(`📁 生成文件名: ${filename}`);
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/mkv', 'video/webm'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
    }
};

// 关键修复：优化multer配置，使用流式处理
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB
        fieldSize: 50 * 1024 * 1024,
        fields: 10, // 限制字段数量
        files: 1,   // 限制文件数量
        parts: 11   // 限制部分数量
    },
    fileFilter: fileFilter
});

// 增强的上传中间件 - 添加内存保护
const uploadMiddleware = (req, res, next) => {
    console.log('🔄 开始大文件上传处理...');

    // 设置更长的超时时间
    req.setTimeout(60 * 60 * 1000); // 60分钟
    res.setTimeout(60 * 60 * 1000);

    // 禁用body解析，让multer处理
    if (req.readable) {
        req.pause(); // 暂停请求直到multer准备好
    }

    upload.single('video')(req, res, function (err) {
        if (req.readable) {
            req.resume(); // 恢复请求
        }

        if (err) {
            console.error('❌ 上传中间件错误:', err);

            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({
                        error: '文件太大',
                        maxSize: '2GB'
                    });
                }
                if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                    return res.status(400).json({ error: '文件字段名不正确，应使用 "video"' });
                }
                return res.status(400).json({ error: `上传错误: ${err.message}` });
            }
            return res.status(500).json({ error: err.message });
        }

        if (req.file) {
            console.log(`✅ Multer处理完成: ${req.file.originalname} (${formatFileSize(req.file.size)})`);
        } else {
            console.warn('⚠️  Multer处理完成，但未找到文件');
        }

        next();
    });
};

// 内存保护中间件
router.use('/upload', (req, res, next) => {
    // 限制请求体大小
    if (parseInt(req.headers['content-length']) > 2 * 1024 * 1024 * 1024) {
        return res.status(413).json({ error: '请求体过大' });
    }
    next();
});

// 增强的上传接口
router.post('/', authenticateToken, uploadMiddleware, async (req, res) => {
    let uploadSuccess = false;
    let tempFilePath = null;
    let videoRecord = null;

    try {
        console.log('🎬 开始处理上传业务逻辑...');

        if (!req.file) {
            return res.status(400).json({ error: '没有上传文件' });
        }

        tempFilePath = req.file.path;
        const { title, description } = req.body;

        console.log(`📋 接收文件: ${req.file.originalname}`);

        // 关键：立即验证文件完整性
        const fileStats = await fs.stat(tempFilePath);
        const actualFileSize = fileStats.size;

        console.log(`📊 文件实际大小: ${formatFileSize(actualFileSize)}`);

        // 更严格的完整性检查
        if (actualFileSize < 1024) { // 小于1KB认为不完整
            throw new Error('文件上传不完整，文件大小异常');
        }

        // 检查文件是否可读
        try {
            const testStream = fs.createReadStream(tempFilePath, { start: 0, end: 100 });
            await new Promise((resolve, reject) => {
                testStream.on('readable', resolve);
                testStream.on('error', reject);
            });
            testStream.destroy();
        } catch (streamError) {
            throw new Error('文件损坏或不可读: ' + streamError.message);
        }

        const fileInfo = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: actualFileSize,
            mimetype: req.file.mimetype,
            path: tempFilePath,
            uploadTime: new Date().toISOString(),
            userId: req.user.id,
            username: req.user.username,
            title: title || path.parse(req.file.originalname).name,
            description: description || ''
        };

        console.log(`💾 创建视频记录...`);

        // 创建视频记录
        videoRecord = await createVideoRecord({
            filename: fileInfo.filename,
            original_name: fileInfo.originalname,
            file_path: fileInfo.path,
            file_size: fileInfo.size,
            mime_type: fileInfo.mimetype,
            user_id: fileInfo.userId,
            title: fileInfo.title,
            description: fileInfo.description,
            status: 'uploading' // 初始状态
        });

        console.log(`✅ 视频记录创建成功: ${videoRecord.id}`);

        // 标记上传成功
        uploadSuccess = true;

        // 立即响应客户端，避免客户端超时
        res.json({
            message: '文件上传成功，正在处理中...',
            videoId: videoRecord.id,
            file: {
                filename: fileInfo.filename,
                originalname: fileInfo.originalname,
                size: fileInfo.size
            },
            streamUrl: `/api/videos/stream/${fileInfo.filename}`,
            directUrl: `/uploads/videos/${fileInfo.filename}`,
            status: 'processing'
        });

        // 异步处理后续任务
        processUploadSuccess(videoRecord.id, fileInfo).catch(error => {
            console.error(`❌ 后续处理失败 ${videoRecord.id}:`, error);
            // 更新状态为错误，但不影响客户端响应
            updateVideoStatus(videoRecord.id, 'error').catch(console.error);
        });

    } catch (error) {
        console.error('❌ 上传业务逻辑错误:', error);

        // 清理不完整的文件
        if (!uploadSuccess && tempFilePath) {
            try {
                if (await fs.pathExists(tempFilePath)) {
                    const stats = await fs.stat(tempFilePath);
                    console.log(`🧹 清理不完整文件: ${tempFilePath} (${formatFileSize(stats.size)})`);
                    await fs.remove(tempFilePath);
                }
            } catch (cleanupError) {
                console.error('清理文件失败:', cleanupError);
            }
        }

        // 清理数据库记录
        if (videoRecord && !uploadSuccess) {
            try {
                // 如果有删除视频记录的方法，调用它
                console.log(`🧹 清理数据库记录: ${videoRecord.id}`);
            } catch (dbCleanupError) {
                console.error('清理数据库记录失败:', dbCleanupError);
            }
        }

        res.status(500).json({
            error: '文件上传失败',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 修改 processUploadSuccess 函数 - 使用队列系统
async function processUploadSuccess(videoId, fileInfo) {
    try {
        console.log(`🔄 开始处理上传成功后的任务 ${videoId}`);

        // 更新状态为处理中
        await updateVideoStatus(videoId, 'processing');

        // 将分析任务添加到队列
        const job = await videoQueue.add('video-analysis', {
            videoId: videoId,
            filePath: fileInfo.path,
            filename: fileInfo.filename,
            userId: fileInfo.userId,
            username: fileInfo.username,
            title: fileInfo.title,
            description: fileInfo.description,
            uploadTime: fileInfo.uploadTime
        });

        console.log(`✅ 分析任务已提交到队列: ${videoId}, 任务ID: ${job.id}`);

        // 这里不需要等待分析完成，队列系统会处理
        // 分析完成后会通过webhook回调更新状态

        console.log(`🎉 用户 ${fileInfo.username} 成功上传视频并提交分析: ${fileInfo.originalname}`);

    } catch (error) {
        console.error(`❌ 上传后处理失败 ${videoId}:`, error);
        await updateVideoStatus(videoId, 'error');
        throw error;
    }
}


// 生成缩略图
async function generateThumbnail(videoId, filePath) {
    try {
        const thumbnailFilename = `thumbnail-${videoId}.svg`;
        const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);

        const placeholderSvg = `
            <svg width="320" height="180" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#4A5568"/>
                <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                      fill="white" font-family="Arial" font-size="20">视频缩略图</text>
            </svg>
        `;

        await fs.writeFile(thumbnailPath, placeholderSvg);
        return thumbnailPath;
    } catch (error) {
        console.error('生成缩略图错误:', error);
        return null;
    }
}

// 获取用户上传的视频列表
router.get('/my-uploads', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const userVideos = await getVideosByUserId(req.user.id);

        const videosWithUrls = userVideos.map(video => ({
            id: video.id,
            title: video.title,
            description: video.description,
            filename: video.filename,
            originalName: video.original_name,
            size: formatFileSize(video.file_size),
            duration: video.duration,
            status: video.status,
            thumbnailUrl: video.thumbnail_path ? `/uploads/thumbnails/${path.basename(video.thumbnail_path)}` : null,
            streamUrl: `/api/videos/stream/${video.filename}`,
            downloadUrl: `/api/videos/download/${video.filename}`,
            uploadTime: video.created_at,
            views: 0
        }));

        res.json({
            total: userVideos.length,
            page: parseInt(page),
            limit: parseInt(limit),
            videos: videosWithUrls.slice(offset, offset + parseInt(limit))
        });
    } catch (error) {
        console.error('获取用户视频列表错误:', error);
        res.status(500).json({ error: '获取视频列表失败' });
    }
});

// 文件完整性检查端点
router.get('/:filename/verify', authenticateToken, async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(uploadDir, filename);

        if (!await fs.pathExists(filePath)) {
            return res.status(404).json({ error: '文件不存在' });
        }

        const stats = await fs.stat(filePath);
        const fileInfo = {
            filename,
            size: stats.size,
            formattedSize: formatFileSize(stats.size),
            created: stats.birthtime,
            modified: stats.mtime
        };

        res.json({ file: fileInfo });
    } catch (error) {
        console.error('文件验证错误:', error);
        res.status(500).json({ error: '文件验证失败' });
    }
});

// 格式化文件大小
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
// 在 routes/upload.js 中添加服务健康检查
async function checkAnalysisServiceHealth() {
    try {
        const response = await fetch(`${ANALYSIS_SERVICE_URL}/api/health`, {
            timeout: 5000
        });

        if (response.ok) {
            const health = await response.json();
            console.log('✅ 分析服务健康状态:', health);
            return true;
        } else {
            console.error('❌ 分析服务健康检查失败:', response.status);
            return false;
        }
    } catch (error) {
        console.error('❌ 无法连接到分析服务:', error.message);
        return false;
    }
}
export default router;