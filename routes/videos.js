import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import mime from 'mime-types';
import { getVideosWithAnalysis, getVideosByStatus, getAllVideos } from '../models/db.js';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

const router = express.Router();

const videoDir = path.join(process.cwd(), 'uploads', 'videos');
const thumbnailsDir = path.join(process.cwd(), 'uploads', 'thumbnails');

// 视频流播放 - 增强调试版本
router.get('/stream/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(videoDir, filename);

        console.log(`🎬 视频流请求: ${filename}`);
        console.log(`📁 完整路径: ${filePath}`);
        console.log(`🔍 Range头: ${req.headers.range}`);

        // 检查文件是否存在
        if (!await fs.pathExists(filePath)) {
            console.error(`❌ 文件不存在: ${filePath}`);
            return res.status(404).json({
                error: '文件不存在',
                filename: filename,
                path: filePath
            });
        }

        const stat = await fs.stat(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        console.log(`📊 文件大小: ${fileSize} bytes`);
        console.log(`📄 MIME类型: ${mime.lookup(filePath)}`);

        // 设置通用的响应头
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', mime.lookup(filePath) || 'video/mp4');

        // 添加CORS头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            console.log(`🔢 范围解析: start=${start}, end=${end}`);

            if (start >= fileSize) {
                console.error(`❌ 范围超出文件大小: ${start} >= ${fileSize}`);
                res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
                return res.end();
            }

            const chunksize = (end - start) + 1;
            console.log(`📦 分块大小: ${chunksize}`);

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunksize,
                'Accept-Ranges': 'bytes',
            });

            const fileStream = fs.createReadStream(filePath, { start, end });

            fileStream.on('error', (streamError) => {
                console.error('❌ 文件流错误:', streamError);
                if (!res.headersSent) {
                    res.status(500).json({ error: '文件流读取失败' });
                }
            });

            fileStream.pipe(res);

            fileStream.on('end', () => {
                console.log(`✅ 视频流传输完成: ${filename}`);
            });

        } else {
            console.log(`🔧 完整文件传输`);
            res.writeHead(200, {
                'Content-Length': fileSize,
            });

            const fileStream = fs.createReadStream(filePath);
            fileStream.on('error', (streamError) => {
                console.error('❌ 完整文件流错误:', streamError);
            });
            fileStream.pipe(res);
        }

    } catch (error) {
        console.error('❌ 视频流处理错误:', error);
        if (!res.headersSent) {
            res.status(500).json({
                error: '视频流传输失败',
                details: error.message
            });
        }
    }
});

// 添加文件检查端点用于调试
router.get('/debug/file-info/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(videoDir, filename);

        console.log(`🔍 调试文件信息: ${filename}`);

        const exists = await fs.pathExists(filePath);
        if (!exists) {
            return res.status(404).json({
                error: '文件不存在',
                filename,
                videoDir,
                fullPath: filePath
            });
        }

        const stat = await fs.stat(filePath);
        const mimeType = mime.lookup(filePath);

        res.json({
            exists: true,
            filename,
            path: filePath,
            size: stat.size,
            sizeFormatted: `${(stat.size / (1024 * 1024)).toFixed(2)} MB`,
            mimeType: mimeType,
            created: stat.birthtime,
            modified: stat.mtime,
            permissions: {
                readable: true, // 假设可读
                // 在实际代码中你可能需要检查具体权限
            }
        });

    } catch (error) {
        console.error('文件信息调试错误:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const videoId = req.params.id;

        const video = await getVideoById(videoId);

        if (!video) {
            return res.status(404).json({ error: '视频不存在' });
        }

        const videoDetails = {
            id: video.id,
            title: video.title,
            description: video.description,
            filename: video.filename,
            username: video.username,
            size: formatFileSize(video.file_size),
            duration: formatDuration(video.duration),
            status: video.status,
            analysisStatus: video.analysis_status,
            thumbnailUrl: video.thumbnail_path ? `/uploads/thumbnails/${path.basename(video.thumbnail_path)}` : null,
            streamUrl: `/api/videos/stream/${video.filename}`,
            downloadUrl: `/api/videos/download/${video.filename}`,
            uploadTime: video.created_at,
            analyzedAt: video.analyzed_at,
            mimeType: video.mime_type
        };



        res.json({ video: videoDetails });
    } catch (error) {
        res.status(500).json({ error: '获取视频详情失败' });
    }
});
/**
 * 获取视频分析详情
 */
router.get('/:id/analysis', async (req, res) => {
    try {
        const videoId = req.params.id;
        const analysisData = await getVideoAnalysis(videoId);

        if (!analysisData) {
            return res.status(404).json({
                error: '视频分析结果不存在',
                videoId: videoId
            });
        }

        res.json({
            videoId: analysisData.id,
            title: analysisData.title,
            analysisStatus: analysisData.analysis_status,
            analyzedAt: analysisData.analyzed_at,

            // 基础分析结果
            summary: {
                sceneCount: analysisData.scene_count,
                objectCount: analysisData.object_count,
                confidenceScore: analysisData.confidence_score,
                qualityScore: analysisData.quality_score,
                analysisDuration: analysisData.analysis_duration,
                resolution: analysisData.resolution,
                frameRate: analysisData.frame_rate
            },

            // 内容分析
            content: {
                summary: analysisData.content_summary,
                emotion: analysisData.emotion_analysis ?
                    JSON.parse(analysisData.emotion_analysis) : null,
                timeline: analysisData.timeline_analysis ?
                    JSON.parse(analysisData.timeline_analysis) : null
            },

            // 分类和标签
            classification: {
                tags: analysisData.tags ? JSON.parse(analysisData.tags) : [],
                categories: analysisData.categories ? JSON.parse(analysisData.categories) : []
            },

            // 原始分析结果
            rawResult: analysisData.analysis_result ?
                JSON.parse(analysisData.analysis_result) : null,

            artifacts: analysisData.artifacts ?
                JSON.parse(analysisData.artifacts) : null
        });

    } catch (error) {
        console.error('❌ 获取视频分析详情错误:', error);
        res.status(500).json({
            error: '获取分析详情失败',
            details: error.message
        });
    }
});

/**
 * 获取视频状态统计
 */
router.get('/stats/status', async (req, res) => {
    try {
        const allVideos = await getVideosWithAnalysis(1000, 0);

        const stats = {
            total: allVideos.length,
            byStatus: {
                uploading: allVideos.filter(v => v.status === 'uploading').length,
                processing: allVideos.filter(v => v.status === 'processing').length,
                ready: allVideos.filter(v => v.status === 'ready').length,
                error: allVideos.filter(v => v.status === 'error').length
            },
            byAnalysisStatus: {
                pending: allVideos.filter(v => v.analysis_status === 'pending').length,
                analyzing: allVideos.filter(v => v.analysis_status === 'analyzing').length,
                completed: allVideos.filter(v => v.analysis_status === 'completed').length,
                failed: allVideos.filter(v => v.analysis_status === 'failed').length
            },
            byUser: {}
        };

        // 按用户统计
        allVideos.forEach(video => {
            if (video.username) {
                stats.byUser[video.username] = (stats.byUser[video.username] || 0) + 1;
            }
        });

        res.json(stats);

    } catch (error) {
        console.error('❌ 获取视频统计错误:', error);
        res.status(500).json({ error: '获取统计信息失败' });
    }
});
// 辅助函数
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds) return '未知';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 辅助函数

/**
 * 解析分析结果
 */
function parseAnalysisResult(resultString) {
    if (!resultString) return null;
    try {
        return JSON.parse(resultString);
    } catch (e) {
        console.error('解析分析结果JSON失败:', e);
        return null;
    }
}
// 检查视频编码信息
router.get('/debug/video-codec/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(videoDir, filename);

        if (!await fs.pathExists(filePath)) {
            return res.status(404).json({ error: '文件不存在' });
        }

        // 使用 ffprobe 检查视频编码
        const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;

        try {
            const { stdout } = await execAsync(command);
            const probeData = JSON.parse(stdout);

            res.json({
                filename,
                format: probeData.format,
                streams: probeData.streams
            });
        } catch (ffmpegError) {
            // 如果没有 ffprobe，尝试其他方法
            console.warn('ffprobe 不可用，使用备选方案');

            // 备选方案：读取文件头信息
            const buffer = await fs.readFile(filePath, { end: 1024 }); // 读取前1KB
            const hex = buffer.toString('hex');

            res.json({
                filename,
                warning: 'ffprobe不可用，使用基础检查',
                fileHeader: hex.substring(0, 100),
                size: (await fs.stat(filePath)).size,
                basicCheck: '请安装ffmpeg以获得详细编码信息'
            });
        }

    } catch (error) {
        console.error('检查视频编码错误:', error);
        res.status(500).json({ error: error.message });
    }
});
// 转码视频为浏览器兼容格式
router.post('/transcode/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const inputPath = path.join(videoDir, filename);
        const outputFilename = filename.replace('.mp4', '_h264.mp4');
        const outputPath = path.join(videoDir, outputFilename);

        if (!await fs.pathExists(inputPath)) {
            return res.status(404).json({ error: '文件不存在' });
        }

        console.log(`🔄 开始转码: ${filename} (MPEG4 -> H264)`);

        // 转码为浏览器兼容的 H.264 格式
        const command = `ffmpeg -i "${inputPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;

        const { stdout, stderr } = await execAsync(command);

        console.log(`✅ 转码完成: ${outputFilename}`);

        res.json({
            success: true,
            original: filename,
            transcoded: outputFilename,
            originalCodec: 'mpeg4',
            transcodedCodec: 'h264',
            message: '视频已转码为浏览器兼容的H.264格式'
        });

    } catch (error) {
        console.error('转码错误:', error);
        res.status(500).json({
            error: '转码失败',
            details: error.message,
            note: '请确保已安装 ffmpeg'
        });
    }
});

// 批量转码所有分析后视频
router.post('/transcode-all-annotated', async (req, res) => {
    try {
        const files = await fs.readdir(videoDir);
        const annotatedFiles = files.filter(f => f.includes('_annotated.mp4') && !f.includes('_h264.mp4'));

        const results = [];

        for (const filename of annotatedFiles) {
            try {
                const inputPath = path.join(videoDir, filename);
                const outputFilename = filename.replace('.mp4', '_h264.mp4');
                const outputPath = path.join(videoDir, outputFilename);

                // 跳过已存在的转码文件
                if (await fs.pathExists(outputPath)) {
                    console.log(`⏭️ 跳过已转码文件: ${outputFilename}`);
                    continue;
                }

                console.log(`🔄 转码: ${filename}`);
                const command = `ffmpeg -i "${inputPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;
                await execAsync(command);

                results.push({
                    original: filename,
                    transcoded: outputFilename,
                    status: 'success'
                });

                console.log(`✅ 完成: ${outputFilename}`);

            } catch (error) {
                console.error(`❌ 转码失败 ${filename}:`, error.message);
                results.push({
                    original: filename,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `批量转码完成: ${results.filter(r => r.status === 'success').length} 成功, ${results.filter(r => r.status === 'failed').length} 失败`,
            results
        });

    } catch (error) {
        console.error('批量转码错误:', error);
        res.status(500).json({ error: error.message });
    }
});
export default router;