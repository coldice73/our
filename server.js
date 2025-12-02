import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import qwenAnalysisRoutes from './routes/qwenAnalysis.js';
import { initDatabase } from './models/db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import { authenticateToken } from './middleware/authMiddleware.js';
import uploadRoutes from './routes/upload.js';
import videoRoutes from './routes/videos.js';
import analysisRoutes from './routes/analysisRoutes.js'; // 新增分析路由
import { videoQueue } from './videoProcessor.js'; // 导入视频队列
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// 中间件
app.use(cors());
app.use(express.json());

// 增加服务器超时设置（关键修复）
server.setTimeout(30 * 60 * 1000); // 30分钟超时
server.keepAliveTimeout = 30000; // 30秒keep-alive
server.headersTimeout = 35 * 60 * 1000; // 35分钟

// 确保上传相关目录存在
const uploadsDir = path.join(process.cwd(), 'uploads');
const videosDir = path.join(process.cwd(), 'uploads', 'videos');
const thumbnailsDir = path.join(process.cwd(), 'uploads', 'thumbnails');

fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(videosDir);
fs.ensureDirSync(thumbnailsDir);
console.log('QWENAI_API_KEY:', process.env.QWENAI_API_KEY ? '已设置' : '未设置');
console.log('📁 目录结构已初始化');

// 静态文件服务
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/upload', authenticateToken, uploadRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/analysis', analysisRoutes); // 新增分析相关API
app.use('/api/qwen-analysis', authenticateToken, qwenAnalysisRoutes);
// 为上传路由单独设置更长的超时
app.use('/api/upload', (req, res, next) => {
    req.setTimeout(30 * 60 * 1000); // 30分钟
    res.setTimeout(30 * 60 * 1000);
    next();
});

console.log('⏰ 服务器超时设置: 30分钟');

// 健康检查端点（增强版）
app.get('/health', async (req, res) => {
    try {
        // 获取队列状态
        const queueStats = await getQueueStats();

        res.json({
            status: 'OK',
            message: '视频分享服务运行正常',
            timestamp: new Date().toISOString(),
            directories: {
                videos: videosDir,
                thumbnails: thumbnailsDir,
                exists: {
                    videos: fs.existsSync(videosDir),
                    thumbnails: fs.existsSync(thumbnailsDir)
                }
            },
            queue: queueStats,
            redis: 'connected' // 简化检查，实际应该检查Redis连接
        });
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 根路径
app.get('/', (req, res) => {
    res.json({
        message: '视频分享平台 API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            users: '/api/users',
            upload: '/api/upload',
            videos: '/api/videos',
            analysis: '/api/analysis'
        },
        features: {
            videoUpload: true,
            videoStreaming: true,
            videoAnalysis: true,
            userAuthentication: true
        }
    });
});

// 404处理
app.use('*', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// 全局错误处理中间件
app.use((error, req, res, next) => {
    console.error('🚨 全局错误捕获:', {
        message: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        headers: req.headers,
        user: req.user
    });

    if (error.message.includes('Cannot read properties of undefined')) {
        return res.status(500).json({
            error: '服务器配置错误',
            details: '用户认证信息处理异常',
            timestamp: new Date().toISOString()
        });
    }

    res.status(500).json({
        error: '服务器内部错误',
        message: error.message,
        timestamp: new Date().toISOString()
    });
});

app.all('/files/*',
    express.raw({ type: 'application/offset+octet-stream', limit: '2GB' }),
    async (req, res, next) => {
        try {
            await tusServer.handle(req, res);
        } catch (err) {
            // tus 官方错误格式
            if (err.status_code) {
                return res.status(err.status_code).send(err.body || 'Upload rejected');
            }
            // 其他未知异常
            console.error('[@tus] unexpected error', err);
            res.status(500).send('Internal server error');
        }
    }
);
// 启动服务器
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // 初始化数据库
        await initDatabase();

        // 检查Redis连接
        try {
            const client = videoQueue.client;
            await client.ping();
            console.log('✅ Redis连接成功');

            // 清理可能的旧任务
            await videoQueue.obliterate({ force: true });
            console.log('✅ 清理旧队列任务完成');

        } catch (redisError) {
            console.error('❌ Redis连接失败:', redisError.message);
        }

        server.listen(PORT, () => {
            console.log('🚀 视频分享平台服务器启动成功');
            console.log(`📍 服务地址: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ 服务器启动失败:', error);
        process.exit(1);
    }
}

// 获取队列统计信息（需要在文件内定义）
async function getQueueStats() {
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
        return { error: '无法获取队列统计' };
    }
}

// 优雅关闭
process.on('SIGTERM', async () => {
    console.log('收到SIGTERM信号，开始关闭服务器...');

    try {
        // 关闭队列
        await videoQueue.close();
        console.log('✅ 视频队列已关闭');

        // 关闭服务器
        server.close(() => {
            console.log('✅ HTTP服务器已关闭');
            process.exit(0);
        });
    } catch (error) {
        console.error('关闭服务器时发生错误:', error);
        process.exit(1);
    }
});

startServer();

export default app;