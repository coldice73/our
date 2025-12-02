// videoProcessor.js - 修改分析请求部分
import Queue from 'bull';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { updateVideoAnalysis, updateVideoStatus } from './models/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 创建视频处理队列
const videoQueue = new Queue('video processing', {
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB || 0
    }
});

// 分析系统API配置
const ANALYSIS_SYSTEM_BASE_URL = process.env.ANALYSIS_SYSTEM_URL || 'http://localhost:3001';
const ANALYSIS_TIMEOUT = 3000000; // 50分钟超时

// 分析任务状态追踪
const analysisStatus = new Map();

// 处理视频分析任务
videoQueue.process('video-analysis', 3, async (job) => { // 减少并发数，避免过载
    const {
        videoId,
        filePath,
        filename,
        userId,
        username,
        title,
        description,
        uploadTime
    } = job.data;

    console.log(`🎬 开始处理视频分析任务: ${videoId} (${filename})`);

    // 更新任务状态
    analysisStatus.set(String(videoId), {
        status: 'processing',
        startedAt: new Date(),
        jobId: job.id
    });

    try {
        // 检查文件是否存在
        if (!await fs.pathExists(filePath)) {
            throw new Error(`视频文件不存在: ${filePath}`);
        }

        // 获取文件信息
        const fileStat = await fs.stat(filePath);
        const fileSize = fileStat.size;

        console.log(`📊 视频文件信息: ${filename} (${formatFileSize(fileSize)})`);

        // 构建可访问的视频URL - 确保URL正确
        const videoUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/videos/stream/${filename}`;
        console.log(`🔗 视频访问URL: ${videoUrl}`);

        // 检查视频URL是否可访问（可选，用于调试）
        try {
            const testResponse = await fetch(videoUrl, { method: 'HEAD', timeout: 10000 });
            console.log(`🔍 视频URL可访问性检查: ${testResponse.status}`);
        } catch (testError) {
            console.warn(`⚠️ 视频URL可能无法访问: ${videoUrl}`, testError.message);
        }

        // 发送到分析系统 - 使用完整的请求格式
        const analysisResult = await sendToAnalysisSystem({
            videoId: String(videoId),
            url: videoUrl,
            filename: filename,
            title: title || '未命名视频',
            userId: userId ? String(userId) : 'unknown',
            outputDir: `C:\\Users\\14804\\Desktop\\PROJECE_ONE\\ptProcess\\analysis_output\\${videoId}`
        });

        console.log(`✅ 分析服务响应接收: ${videoId}`, {
            success: analysisResult.success,
            message: analysisResult.message
        });

        // 更新任务状态
        analysisStatus.set(String(videoId), {
            status: 'completed',
            startedAt: analysisStatus.get(String(videoId)).startedAt,
            completedAt: new Date(),
            result: analysisResult
        });

        // 分析服务会通过webhook回调处理结果，这里只需要标记为处理中
        // 实际的结果处理会在webhook回调中完成

        return {
            success: true,
            videoId,
            analysisResult,
            processingTime: Date.now() - job.timestamp,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ 视频分析失败: ${videoId}`, error);

        // 更新任务状态
        analysisStatus.set(String(videoId), {
            status: 'failed',
            startedAt: analysisStatus.get(String(videoId)).startedAt,
            failedAt: new Date(),
            error: error.message
        });

        // 更新数据库状态
        try {
            await updateVideoAnalysis(videoId, {
                status: 'failed',
                error: error.message,
                analyzed_at: new Date()
            });

            await updateVideoStatus(videoId, 'error');
        } catch (dbError) {
            console.error(`❌ 更新数据库状态失败: ${videoId}`, dbError);
        }

        if (shouldRetry(error)) {
            console.log(`🔄 任务将重试: ${videoId}`);
            throw error;
        }

        throw new Error(`分析失败: ${error.message}`);
    }
});

// 增强的发送到分析系统函数
async function sendToAnalysisSystem(videoData) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT);

    try {
        console.log(`📤 发送分析请求到: ${ANALYSIS_SYSTEM_BASE_URL}/api/analyze`);

        // 构建请求体，确保与Python服务期望的格式匹配
        const requestBody = {
            videoId: String(videoData.videoId),
            url: String(videoData.url),
            filename: videoData.filename || 'unknown',
            title: videoData.title || '未命名视频',
            userId: videoData.userId || 'unknown',
            outputDir: videoData.outputDir,
            callbackUrl: `${process.env.APP_URL || 'http://localhost:3000'}/api/analysis/webhook/analysis-complete`
        };

        console.log(`📦 请求数据:`, JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${ANALYSIS_SYSTEM_BASE_URL}/api/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ 分析服务响应错误: ${response.status}`, errorText);

            // 尝试解析错误详情
            let errorDetail = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                errorDetail = errorJson.detail || JSON.stringify(errorJson);
            } catch (parseError) {
                // 保持原始错误文本
            }

            throw new Error(`分析服务响应错误: ${response.status} - ${errorDetail}`);
        }

        const result = await response.json();
        console.log(`✅ 分析服务返回成功:`, result);

        return result;

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('分析请求超时');
        }
        console.error(`❌ 发送分析请求失败:`, error.message);
        throw error;
    }
}

// 重试判断逻辑
function shouldRetry(error) {
    const retryableErrors = [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENETUNREACH',
        'ECONNRESET',
        '分析请求超时',
        '分析服务响应错误'
    ];

    return retryableErrors.some(retryableError =>
        error.message.includes(retryableError) || error.code === retryableError
    );
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 队列事件监听
videoQueue.on('completed', (job, result) => {
    console.log(`✅ 任务完成: ${job.id} (视频: ${result.videoId})`);
});

videoQueue.on('failed', (job, err) => {
    console.error(`❌ 任务失败: ${job.id}`, {
        error: err.message,
        videoId: job.data.videoId,
        attempts: job.attemptsMade
    });
});

videoQueue.on('stalled', (job) => {
    console.warn(`⚠️ 任务停滞: ${job.id}`);
});

videoQueue.on('waiting', (jobId) => {
    console.log(`⏳ 任务等待: ${jobId}`);
});

videoQueue.on('active', (job) => {
    console.log(`🎯 任务开始执行: ${job.id} (视频: ${job.data.videoId})`);
});

videoQueue.on('error', (error) => {
    console.error(`🚨 队列错误:`, error);
});

// 获取分析状态
export function getAnalysisStatus(videoId) {
    return analysisStatus.get(videoId) || { status: 'not_found' };
}

// 获取队列统计信息
export async function getQueueStats() {
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            videoQueue.getWaiting(),
            videoQueue.getActive(),
            videoQueue.getCompleted(),
            videoQueue.getFailed(),
            videoQueue.getDelayed()
        ]);

        return {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
            delayed: delayed.length,
            total: waiting.length + active.length + completed.length + failed.length + delayed.length
        };
    } catch (error) {
        console.error('获取队列统计失败:', error);
        return {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            total: 0,
            error: error.message
        };
    }
}

export { videoQueue };