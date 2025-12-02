// routes/qwenAnalysis.js - 完全重写
import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import qwenAIService from '../routes/qwenAIService.js';
import { getVideoAnalysis } from '../models/db.js'

const router = express.Router();

/**
 * 对单个视频进行QwenAI深度分析 - 直接返回结果给前端
 */
router.post('/analyze/:videoId', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const { analysisType = 'summary' } = req.body;

        console.log(`🎯 开始QwenAI分析视频: ${videoId}, 类型: ${analysisType}`);

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

        // 3. 调用QwenAI服务（直接返回结果，不保存到数据库）
        const aiResult = await qwenAIService.analyzeVideoWithQwen(videoData, analysisType);

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
        console.error('❌ QwenAI分析API错误:', error);
        res.status(500).json({
            error: 'QwenAI分析处理失败',
            details: error.message
        });
    }
});

/**
 * 批量分析用户的所有视频 - 直接返回结果给前端
 */
router.post('/batch-analyze', authenticateToken, async (req, res) => {
    try {
        const { analysisType = 'summary', limit = 10 } = req.body;
        const userId = req.user.id;

        console.log(`🔄 开始批量QwenAI分析，用户: ${userId}, 类型: ${analysisType}`);

        // 1. 获取用户所有已分析完成的视频
        const userVideos = await getVideosWithAnalysis(limit, 0);
        const completedVideos = userVideos.filter(video =>
            video.analysis_status === 'completed' && video.user_id === userId
        );

        if (completedVideos.length === 0) {
            return res.status(404).json({
                error: '没有找到已完成基础分析的视频',
                userId
            });
        }

        // 2. 批量调用QwenAI（直接返回结果，不保存到数据库）
        const batchResults = await qwenAIService.batchAnalyzeVideos(completedVideos, analysisType);

        // 3. 统计结果
        const successCount = batchResults.filter(r => r.success).length;
        const failedCount = batchResults.filter(r => !r.success).length;

        res.json({
            success: true,
            summary: {
                total: completedVideos.length,
                success: successCount,
                failed: failedCount,
                analysisType
            },
            details: batchResults,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ 批量QwenAI分析错误:', error);
        res.status(500).json({
            error: '批量分析失败',
            details: error.message
        });
    }
});

/**
 * 获取实时分析结果（用于前端轮询）
 */
router.get('/result/:videoId', authenticateToken, async (req, res) => {
    try {
        const { videoId } = req.params;

        // 这里可以添加实时分析状态检查
        // 目前直接返回需要前端重新请求分析

        res.json({
            success: true,
            message: '请使用 POST /api/qwen/analyze/:videoId 进行实时分析',
            videoId
        });

    } catch (error) {
        console.error('❌ 获取分析结果错误:', error);
        res.status(500).json({
            error: '获取分析结果失败',
            details: error.message
        });
    }
});

/**
 * 获取可用的分析类型
 */
router.get('/analysis-types', authenticateToken, async (req, res) => {
    const analysisTypes = [
        {
            id: 'summary',
            name: '内容总结',
            description: '生成视频内容的全面总结报告',
            icon: '📊',
            recommended: true
        },
        {
            id: 'medical',
            name: '医学分析',
            description: '针对医学影像的专业分析',
            icon: '🏥',
            recommended: true
        },
        {
            id: 'technical',
            name: '技术分析',
            description: '从技术角度分析视频质量',
            icon: '🔧'
        },
        {
            id: 'educational',
            name: '教育价值',
            description: '分析视频的教育意义和应用场景',
            icon: '🎓'
        }
    ];

    res.json({ analysisTypes });
});

export default router;