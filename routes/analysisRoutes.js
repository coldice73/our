import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import {
    updateVideoAnalysis,
    updateVideoStatus,
    getVideoById,
    getVideoAnalysis,
    createVideoAnalysisDetail,
    importVideoStatsFromAnalysisDB,  // 导入新函数
    copyAnalysisDatabase,           // 新增
    getVideoAnalysisStats,          // 新增
    getVideoAnalysisEvents,         // 新增
    checkAnalysisDataExists,        // 新增
} from '../models/db.js'; // 确保正确导入数据库函数
import fs from 'fs-extra';
import path from 'path';
import QwenAIService from './qwenAIService.js'
import mime from 'mime-types';
const execAsync = promisify(exec);
import { exec } from 'child_process';
import { promisify } from 'util';

const router = express.Router();
// 分析输出目录基础路径
const ANALYSIS_OUTPUT_BASE = 'C:\\Users\\14804\\Desktop\\PROJECE_ONE\\ptProcess\\analysis_output';

// routes/analysisRoutes.js - 添加新的API端点

/**
 * 获取分析输出目录的文件列表
 */
router.get('/:videoId/output-files', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const outputDir = path.join(ANALYSIS_OUTPUT_BASE, videoId);

        console.log(`📁 获取分析输出文件列表: ${outputDir}`);

        if (!await fs.pathExists(outputDir)) {
            return res.status(404).json({
                error: '分析输出目录不存在',
                videoId,
                outputDir
            });
        }

        const files = await fs.readdir(outputDir);
        const fileDetails = [];

        for (const file of files) {
            const filePath = path.join(outputDir, file);
            const stats = await fs.stat(filePath);

            fileDetails.push({
                name: file,
                path: filePath,
                size: stats.size,
                modified: stats.mtime,
                isDirectory: stats.isDirectory()
            });
        }

        res.json({
            success: true,
            videoId,
            outputDir,
            files: fileDetails
        });

    } catch (error) {
        console.error('获取分析输出文件错误:', error);
        res.status(500).json({
            error: '获取文件列表失败',
            details: error.message
        });
    }
});

/**
 * 自动将分析后的视频转码为浏览器兼容的 H.264 格式
 * @param {string} videoId 视频ID
 * @returns 转码结果对象
 */
async function autoTranscodeVideo(videoId) {
    const videoDir = path.join(process.cwd(), 'uploads', 'videos');

    try {
        // 1. 获取视频信息，确定原始分析后视频的文件名
        const videoRecord = await getVideoById(videoId); // 使用你已有的函数
        if (!videoRecord) {
            throw new Error(`未找到视频记录: ${videoId}`);
        }

        // 构建分析后视频的文件名 (假设规则为 原文件名_annotated.mp4)
        const originalAnnotatedFilename = videoRecord.filename.replace('.mp4', '_annotated.mp4');
        const inputPath = path.join(videoDir, originalAnnotatedFilename);

        // 检查分析后视频文件是否存在
        if (!await fs.pathExists(inputPath)) {
            throw new Error(`分析后视频文件不存在: ${inputPath}`);
        }

        // 2. 设置转码输出文件名和路径
        const transcodedFilename = originalAnnotatedFilename.replace('.mp4', '_h264.mp4');
        const outputPath = path.join(videoDir, transcodedFilename);

        // 3. 执行转码命令
        // 使用 FFmpeg 转码为 H.264，并添加 movflags=faststart 便于网络播放
        const ffmpegCommand = [
            'ffmpeg',
            '-i', `"${inputPath}"`,          // 输入文件
            '-c:v', 'libx264',               // 视频编码器
            '-preset', 'fast',               // 编码速度与压缩率的平衡
            '-crf', '23',                    //  Constant Rate Factor, 质量指标
            '-c:a', 'aac',                   // 音频编码器
            '-b:a', '128k',                  // 音频比特率
            '-movflags', '+faststart',       // 将元数据移到文件头，便于在线播放
            '-y',                            // 覆盖输出文件
            `"${outputPath}"`
        ].join(' ');

        console.log(`🎬 执行转码命令: ${ffmpegCommand}`);

        const { stdout, stderr } = await execAsync(ffmpegCommand, { timeout: 600000 }); // 10分钟超时

        // 4. 验证输出文件
        if (await fs.pathExists(outputPath)) {
            const stats = await fs.stat(outputPath);
            if (stats.size > 0) {
                console.log(`✅ 转码成功，文件大小: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
                return {
                    success: true,
                    videoId: videoId,
                    originalFilename: originalAnnotatedFilename,
                    transcodedFilename: transcodedFilename,
                    outputPath: outputPath
                };
            } else {
                throw new Error('转码后文件大小为0');
            }
        } else {
            throw new Error('转码后文件未生成');
        }

    } catch (error) {
        console.error(`❌ 自动转码失败 [${videoId}]:`, error);
        return {
            success: false,
            videoId: videoId,
            error: error.message
        };
    }
}

// 获取视频分析状态
router.get('/status/:videoId', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const status = getAnalysisStatus(videoId);

        res.json({
            videoId,
            status: status.status,
            startedAt: status.startedAt,
            completedAt: status.completedAt,
            failedAt: status.failedAt,
            error: status.error,
            result: status.result
        });
    } catch (error) {
        console.error('获取分析状态错误:', error);
        res.status(500).json({ error: '获取分析状态失败' });
    }
});

// 重新提交分析任务
router.post('/:videoId/retry', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        // 这里需要从数据库获取视频信息
        // const video = await getVideoById(videoId);
        // if (!video) {
        //     return res.status(404).json({ error: '视频不存在' });
        // }

        // 检查视频是否属于当前用户
        // if (video.user_id !== req.user.id) {
        //     return res.status(403).json({ error: '无权操作此视频' });
        // }

        // 重新提交分析任务
        // const job = await videoQueue.add('video-analysis', {
        //     videoId: video.id,
        //     filePath: video.file_path,
        //     filename: video.filename,
        //     userId: req.user.id,
        //     username: req.user.username,
        //     title: video.title,
        //     description: video.description,
        //     uploadTime: video.created_at
        // });

        res.json({
            message: '分析任务已重新提交',
            videoId,
            // jobId: job.id
        });
    } catch (error) {
        console.error('重新提交分析任务错误:', error);
        res.status(500).json({ error: '重新提交分析任务失败' });
    }
});

/**
 * 从分析输出目录读取JSON数据
 */
async function readAnalysisResult(videoId) {
    try {
        const outputDir = path.join(ANALYSIS_OUTPUT_BASE, videoId);
        const jsonFilePath = path.join(outputDir, 'info.json');

        console.log(`📖 尝试读取分析结果: ${jsonFilePath}`);

        if (await fs.pathExists(jsonFilePath)) {
            const jsonData = await fs.readJson(jsonFilePath);
            console.log(`✅ 成功读取分析结果JSON: ${videoId}`);
            return jsonData;
        } else {
            console.warn(`⚠️ 分析结果JSON文件不存在: ${jsonFilePath}`);
            return null;
        }
    } catch (error) {
        console.error(`❌ 读取分析结果失败: ${videoId}`, error);
        return null;
    }
}

/**
 * 读取SQLite数据库分析结果
 */
async function readSQLiteAnalysis(videoId) {
    try {
        const outputDir = path.join(ANALYSIS_OUTPUT_BASE, videoId);
        const dbPath = path.join(outputDir, 'video_stats.db');

        if (await fs.pathExists(dbPath)) {
            // 这里可以添加SQLite数据库读取逻辑
            // 暂时返回文件存在信息
            return {
                dbExists: true,
                dbPath: dbPath
            };
        }
        return null;
    } catch (error) {
        console.error(`❌ 读取SQLite分析结果失败: ${videoId}`, error);
        return null;
    }
}

// 修改 webhook 处理函数 - 去除千问AI自动分析和数据库保存
router.post('/webhook/analysis-complete', async (req, res) => {
    try {
        const { videoId, status, result, error, artifacts, meta } = req.body;

        console.log(`📨 收到分析系统回调 - 视频ID: ${videoId}, 状态: ${status}`);

        if (!videoId) {
            return res.status(400).json({ error: '缺少视频ID' });
        }

        if (status === 'completed') {
            console.log(`✅ 分析完成: ${videoId}`);

            try {
                let completeResult = {
                    ...result,
                    artifacts: artifacts,
                    meta: meta
                };

                // 尝试复制分析数据库
                try {
                    const copyResult = await copyAnalysisDatabase(videoId);
                    completeResult.databaseCopied = copyResult.success;
                    console.log(`✅ 分析数据库复制成功: ${videoId}`);
                } catch (copyError) {
                    console.warn(`⚠️ 分析数据库复制失败: ${videoId}`, copyError.message);
                    completeResult.databaseCopied = false;
                    completeResult.databaseError = copyError.message;

                    // 回退到读取JSON文件
                    const fileAnalysisResult = await readAnalysisResult(videoId);
                    if (fileAnalysisResult) {
                        completeResult = {
                            ...completeResult,
                            ...fileAnalysisResult
                        };
                    }
                }

                // 更新视频分析结果到数据库（仅保存基础分析结果）
                await updateVideoAnalysis(videoId, {
                    status: 'completed',
                    result: completeResult,
                    analyzed_at: new Date()
                });

                // 更新视频状态为ready
                await updateVideoStatus(videoId, 'ready');

                console.log(`💾 基础分析结果已保存到数据库: ${videoId}`);

                // 🟢 新增：自动转码逻辑
                console.log(`🔄 开始自动转码分析后视频: ${videoId}`);
                const transcodeResult = await autoTranscodeVideo(videoId);

                if (transcodeResult.success) {
                    console.log(`✅ 自动转码成功: ${videoId} -> ${transcodeResult.transcodedFilename}`);
                    // 可以更新数据库，记录转码状态或转码后的文件名
                } else {
                    console.warn(`⚠️ 自动转码失败: ${videoId}`, transcodeResult.error);
                    // 可以考虑记录失败日志，但不阻断主流程
                }

            } catch (dbError) {
                console.error(`❌ 保存分析结果到数据库失败: ${videoId}`, dbError);
            }

        } else if (status === 'failed') {
            console.error(`❌ 分析失败: ${videoId}`, error);
            await updateVideoAnalysis(videoId, {
                status: 'failed',
                error: error,
                analyzed_at: new Date()
            });
            await updateVideoStatus(videoId, 'error');
        }

        res.json({
            success: true,
            message: '回调处理成功',
            videoId: videoId
        });

    } catch (error) {
        console.error('处理分析回调错误:', error);
        res.status(500).json({
            error: '处理回调失败',
            details: error.message
        });
    }
});

// 新增：直接获取分析结果的API
router.get('/:videoId/ai-analysis', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const { analysisType = 'summary' } = req.query;

        console.log(`🎯 直接获取AI分析结果: ${videoId}, 类型: ${analysisType}`);

        // 1. 获取视频分析数据
        const videoData = await getVideoAnalysis(videoId);
        if (!videoData) {
            return res.status(404).json({
                error: '视频分析数据不存在',
                videoId
            });
        }

        // 2. 检查分析状态
        if (videoData.analysis_status !== 'completed') {
            return res.status(400).json({
                error: '视频尚未完成基础分析，无法进行AI深度分析',
                currentStatus: videoData.analysis_status
            });
        }

        // 3. 直接调用QwenAI服务并返回结果
        const aiResult = await QwenAIService.analyzeVideoWithQwen(videoData, analysisType);

        if (!aiResult.success) {
            return res.status(500).json({
                error: 'QwenAI分析失败',
                details: aiResult.error,
                videoId
            });
        }

        res.json({
            success: true,
            videoId,
            videoTitle: videoData.title,
            analysisType,
            qwenAnalysis: aiResult.analysis,
            usage: aiResult.usage,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ 直接获取AI分析结果错误:', error);
        res.status(500).json({
            error: '获取AI分析结果失败',
            details: error.message
        });
    }
});

/**
 * 手动从分析文件导入结果到数据库
 */
router.post('/:videoId/import-from-files', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        console.log(`📖 手动导入分析结果: ${videoId}`);

        // 1. 验证视频存在且属于当前用户
        const video = await getVideoById(videoId);
        if (!video) {
            return res.status(404).json({
                error: '视频不存在',
                videoId
            });
        }

        if (video.user_id !== req.user.id) {
            return res.status(403).json({
                error: '无权操作此视频',
                videoId
            });
        }

        // 2. 读取分析结果文件
        const analysisResult = await readAnalysisResult(videoId);

        if (!analysisResult) {
            return res.status(404).json({
                error: '分析结果文件不存在',
                videoId,
                outputDir: path.join(ANALYSIS_OUTPUT_BASE, videoId)
            });
        }

        // 3. 更新数据库
        await updateVideoAnalysis(videoId, {
            status: 'completed',
            result: analysisResult,
            analyzed_at: new Date()
        });

        // 4. 保存详细分析结果到 video_analysis 表
        await createVideoAnalysisDetail({
            video_id: parseInt(videoId),
            scene_count: analysisResult.scene_count || 0,
            object_count: analysisResult.object_count || 0,
            emotion_analysis: analysisResult.emotion_analysis ? JSON.stringify(analysisResult.emotion_analysis) : null,
            content_summary: analysisResult.content_summary,
            timeline_analysis: analysisResult.timeline_analysis ? JSON.stringify(analysisResult.timeline_analysis) : null,
            tags: analysisResult.tags ? JSON.stringify(analysisResult.tags) : null,
            categories: analysisResult.categories ? JSON.stringify(analysisResult.categories) : null,
            confidence_score: analysisResult.confidence_score || 0,
            resolution: analysisResult.resolution,
            frame_rate: analysisResult.frame_rate,
            quality_score: analysisResult.quality_score || 0,
            analysis_version: analysisResult.analysis_version || '1.0',
            analysis_duration: analysisResult.analysis_duration || 0
        });

        // 5. 更新视频状态
        await updateVideoStatus(videoId, 'ready');

        console.log(`✅ 分析结果导入成功: ${videoId}`);

        res.json({
            success: true,
            message: '分析结果导入成功',
            videoId,
            analysisResult: analysisResult
        });

    } catch (error) {
        console.error('导入分析结果错误:', error);
        res.status(500).json({
            error: '导入分析结果失败',
            details: error.message
        });
    }
});

router.get('/diagnostics/service-status', authenticateToken, async (req, res) => {
    try {
        const analysisServiceUrl = process.env.ANALYSIS_SERVICE_URL || 'http://localhost:3001';

        console.log(`🔧 诊断分析服务状态: ${analysisServiceUrl}`);

        let serviceStatus = {
            url: analysisServiceUrl,
            reachable: false,
            health: null,
            error: null
        };

        try {
            const response = await fetch(`${analysisServiceUrl}/api/health`, {
                timeout: 5000
            });

            if (response.ok) {
                serviceStatus.reachable = true;
                serviceStatus.health = await response.json();
            } else {
                serviceStatus.error = `HTTP ${response.status}`;
            }
        } catch (error) {
            serviceStatus.error = error.message;
        }

        // 检查输出目录
        const outputDirStatus = {
            basePath: ANALYSIS_OUTPUT_BASE,
            exists: await fs.pathExists(ANALYSIS_OUTPUT_BASE),
            writable: false
        };

        if (outputDirStatus.exists) {
            try {
                // 测试写入权限
                const testFile = path.join(ANALYSIS_OUTPUT_BASE, 'test_write.txt');
                await fs.writeFile(testFile, 'test');
                await fs.remove(testFile);
                outputDirStatus.writable = true;
            } catch (writeError) {
                outputDirStatus.writable = false;
                outputDirStatus.writeError = writeError.message;
            }
        }

        res.json({
            success: true,
            analysisService: serviceStatus,
            outputDirectory: outputDirStatus,
            environment: {
                ANALYSIS_SERVICE_URL: process.env.ANALYSIS_SERVICE_URL,
                APP_URL: process.env.APP_URL
            }
        });

    } catch (error) {
        console.error('诊断分析服务错误:', error);
        res.status(500).json({
            error: '诊断失败',
            details: error.message
        });
    }
});

/**
 * 获取视频分析队列状态
 */
router.get('/queue/status/:videoId', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        // 从内存状态获取
        const memoryStatus = getAnalysisStatus(videoId);

        // 从队列获取任务状态
        let queueStatus = null;
        const jobs = await videoQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
        const videoJob = jobs.find(job => job.data.videoId == videoId);

        if (videoJob) {
            queueStatus = {
                id: videoJob.id,
                status: await videoJob.getState(),
                progress: videoJob.progress,
                attempts: videoJob.attemptsMade,
                timestamp: videoJob.timestamp
            };
        }

        res.json({
            videoId,
            memoryStatus,
            queueStatus,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('获取分析队列状态错误:', error);
        res.status(500).json({ error: '获取队列状态失败' });
    }
});
/**
 * 重新提交分析任务到队列
 */
router.post('/queue/retry/:videoId', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        // 获取视频信息
        const video = await getVideoById(videoId);
        if (!video) {
            return res.status(404).json({ error: '视频不存在' });
        }

        // 检查视频是否属于当前用户
        if (video.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权操作此视频' });
        }

        // 重新提交分析任务到队列
        const job = await videoQueue.add('video-analysis', {
            videoId: videoId,
            filePath: video.file_path,
            filename: video.filename,
            userId: req.user.id,
            username: req.user.username,
            title: video.title,
            description: video.description,
            uploadTime: video.created_at
        });

        // 更新状态为处理中
        await updateVideoStatus(videoId, 'processing');

        res.json({
            success: true,
            message: '分析任务已重新提交到队列',
            videoId,
            jobId: job.id
        });

    } catch (error) {
        console.error('重新提交分析任务错误:', error);
        res.status(500).json({ error: '重新提交分析任务失败' });
    }
});

// routes/analysisRoutes.js - 添加健康检查端点

/**
 * 检查分析服务状态
 */
router.get('/service/health', async (req, res) => {
    try {
        const analysisServiceUrl = process.env.ANALYSIS_SYSTEM_URL || 'http://localhost:3001';

        console.log(`🔍 检查分析服务健康状态: ${analysisServiceUrl}`);

        let serviceStatus = {
            url: analysisServiceUrl,
            reachable: false,
            health: null,
            error: null
        };

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${analysisServiceUrl}/api/health`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                serviceStatus.reachable = true;
                serviceStatus.health = await response.json();
            } else {
                serviceStatus.error = `HTTP ${response.status}`;
            }
        } catch (error) {
            serviceStatus.error = error.message;
        }

        // 检查输出目录
        const outputDirStatus = {
            basePath: ANALYSIS_OUTPUT_BASE,
            exists: await fs.pathExists(ANALYSIS_OUTPUT_BASE),
            writable: false
        };

        if (outputDirStatus.exists) {
            try {
                // 测试写入权限
                const testFile = path.join(ANALYSIS_OUTPUT_BASE, 'test_write.txt');
                await fs.writeFile(testFile, 'test');
                await fs.remove(testFile);
                outputDirStatus.writable = true;
            } catch (writeError) {
                outputDirStatus.writable = false;
                outputDirStatus.writeError = writeError.message;
            }
        }

        res.json({
            success: true,
            analysisService: serviceStatus,
            outputDirectory: outputDirStatus,
            environment: {
                ANALYSIS_SYSTEM_URL: process.env.ANALYSIS_SYSTEM_URL,
                APP_URL: process.env.APP_URL,
                OUTPUT_ROOT: process.env.OUTPUT_ROOT
            }
        });

    } catch (error) {
        console.error('检查分析服务健康状态错误:', error);
        res.status(500).json({
            error: '检查服务状态失败',
            details: error.message
        });
    }
});

/**
 * 手动触发分析（用于测试）
 */
router.post('/manual-trigger/:videoId', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        console.log(`🔧 手动触发分析: ${videoId}`);

        // 获取视频信息
        const video = await getVideoById(videoId);
        if (!video) {
            return res.status(404).json({ error: '视频不存在' });
        }

        // 检查视频是否属于当前用户
        if (video.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权操作此视频' });
        }

        // 构建视频URL
        const videoUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/videos/stream/${video.filename}`;

        // 直接发送到分析服务（绕过队列）
        const analysisServiceUrl = process.env.ANALYSIS_SYSTEM_URL || 'http://localhost:3001';
        const requestBody = {
            videoId: String(videoId),
            url: videoUrl,
            filename: video.filename,
            title: video.title || '未命名视频',
            userId: String(req.user.id),
            outputDir: `C:\\Users\\14804\\Desktop\\PROJECE_ONE\\ptProcess\\analysis_output\\${videoId}`,
            callbackUrl: `${process.env.APP_URL || 'http://localhost:3000'}/api/analysis/webhook/analysis-complete`
        };

        console.log('🔧 手动触发分析请求:', requestBody);

        const response = await fetch(`${analysisServiceUrl}/api/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`分析服务响应错误: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        // 更新状态为处理中
        await updateVideoStatus(videoId, 'processing');

        res.json({
            success: true,
            message: '分析已手动触发',
            videoId,
            analysisResponse: result
        });

    } catch (error) {
        console.error('手动触发分析错误:', error);
        res.status(500).json({
            error: '手动触发分析失败',
            details: error.message
        });
    }
});
// 新增：数据库复制相关API
router.post('/:videoId/copy-database', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        console.log(`🗃️ 手动复制分析数据库: ${videoId}`);

        // 验证视频存在且属于当前用户
        const video = await getVideoById(videoId);
        if (!video) {
            return res.status(404).json({
                error: '视频不存在',
                videoId
            });
        }

        if (video.user_id !== req.user.id) {
            return res.status(403).json({
                error: '无权操作此视频',
                videoId
            });
        }

        // 复制分析数据库
        const copyResult = await copyAnalysisDatabase(videoId);

        res.json({
            success: true,
            message: '分析数据库复制成功',
            videoId,
            ...copyResult
        });

    } catch (error) {
        console.error('复制分析数据库错误:', error);
        res.status(500).json({
            error: '复制分析数据库失败',
            details: error.message
        });
    }
});

// 新增：获取分析统计数据
router.get('/:videoId/stats', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        const stats = await getVideoAnalysisStats(videoId);
        const events = await getVideoAnalysisEvents(videoId);

        if (!stats) {
            return res.status(404).json({
                error: '分析统计数据不存在',
                videoId
            });
        }

        res.json({
            success: true,
            videoId,
            stats,
            events
        });

    } catch (error) {
        console.error('获取分析统计错误:', error);
        res.status(500).json({
            error: '获取分析统计失败',
            details: error.message
        });
    }
});

// 新增：检查分析数据是否存在
router.get('/:videoId/check-data', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        const exists = await checkAnalysisDataExists(videoId);

        res.json({
            success: true,
            videoId,
            dataExists: exists
        });

    } catch (error) {
        console.error('检查分析数据错误:', error);
        res.status(500).json({
            error: '检查分析数据失败',
            details: error.message
        });
    }
});

/**
 * 获取分析输出目录的文件列表（增强版）
 */
router.get('/:videoId/output-files', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const analysisOutputBase = 'C:\\Users\\14804\\Desktop\\PROJECE_ONE\\ptProcess\\analysis_output';
        const outputDir = path.join(analysisOutputBase, videoId.toString());

        console.log(`📁 获取分析输出文件列表: ${outputDir}`);

        if (!await fs.pathExists(outputDir)) {
            return res.status(404).json({
                error: '分析输出目录不存在',
                videoId,
                outputDir
            });
        }

        const files = await fs.readdir(outputDir);
        const fileDetails = [];

        for (const file of files) {
            const filePath = path.join(outputDir, file);
            const stats = await fs.stat(filePath);

            fileDetails.push({
                name: file,
                path: filePath,
                size: stats.size,
                formattedSize: formatFileSize(stats.size),
                modified: stats.mtime,
                isDirectory: stats.isDirectory(),
                isVideo: isVideoFile(file),
                isAnnotated: file.includes('annotated')
            });
        }

        // 按类型排序：视频文件优先，然后按文件名排序
        fileDetails.sort((a, b) => {
            if (a.isVideo !== b.isVideo) return b.isVideo - a.isVideo;
            if (a.isAnnotated !== b.isAnnotated) return b.isAnnotated - a.isAnnotated;
            return a.name.localeCompare(b.name);
        });

        res.json({
            success: true,
            videoId,
            outputDir,
            files: fileDetails
        });

    } catch (error) {
        console.error('获取分析输出文件错误:', error);
        res.status(500).json({
            error: '获取文件列表失败',
            details: error.message
        });
    }
});

// 辅助函数

/**
 * 根据文件扩展名获取MIME类型
 */
function getMimeType(ext) {
    const mimeTypes = {
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm'
    };
    return mimeTypes[ext] || 'video/mp4';
}

/**
 * 检查文件是否为视频文件
 */
function isVideoFile(filename) {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
    const ext = path.extname(filename).toLowerCase();
    return videoExtensions.includes(ext);
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
export default router;