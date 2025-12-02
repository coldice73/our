import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';  // 添加这行导入

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'database.sqlite');
let db = null;

// models/db.js

export function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('数据库连接错误:', err.message);
                reject(err);
            } else {
                console.log('成功连接到SQLite数据库');
                // 启用外键约束
                db.run('PRAGMA foreign_keys = ON');
                createTables().then(resolve).catch(reject);
            }
        });
    });
}

function createTables() {
    return new Promise((resolve, reject) => {
        const createUserTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createVideosTable = `
            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                duration INTEGER DEFAULT 0,
                mime_type TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                title TEXT,
                description TEXT,
                thumbnail_path TEXT,
                status TEXT DEFAULT 'uploading',
                processing_progress INTEGER DEFAULT 0,
                analysis_result TEXT,
                analysis_status TEXT DEFAULT 'pending',
                analyzed_at DATETIME,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `;

        const createVideoAnalysisTable = `
            CREATE TABLE IF NOT EXISTS video_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id INTEGER NOT NULL,
                scene_count INTEGER DEFAULT 0,
                object_count INTEGER DEFAULT 0,
                emotion_analysis TEXT,
                content_summary TEXT,
                timeline_analysis TEXT,
                tags TEXT,
                categories TEXT,
                confidence_score REAL DEFAULT 0,
                resolution TEXT,
                frame_rate REAL,
                quality_score REAL DEFAULT 0,
                analysis_version TEXT DEFAULT '1.0',
                analysis_duration INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
                UNIQUE(video_id)
            )
        `;

        const createAnalysisQueueTable = `
            CREATE TABLE IF NOT EXISTS analysis_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                priority INTEGER DEFAULT 1,
                attempt_count INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 3,
                last_attempt_at DATETIME,
                next_retry_at DATETIME,
                error_message TEXT,
                error_details TEXT,
                analysis_job_id TEXT,
                callback_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
            )
        `;

        const createAnalysisStatsTable = `
    CREATE TABLE IF NOT EXISTS analysis_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id INTEGER NOT NULL,
        video_name TEXT,
        fps REAL,
        total_frame REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
        UNIQUE(video_id)
    )
`;

        const createAnalysisEventsTable = `
    CREATE TABLE IF NOT EXISTS analysis_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        start_frame INTEGER NOT NULL,
        duration_frames INTEGER NOT NULL,
        disappear_frame INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
    )
`;


        db.serialize(() => {
            // 启用外键
            db.run('PRAGMA foreign_keys = ON');

            db.run(createUserTable, (err) => {
                if (err) {
                    console.error('创建用户表错误:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ 用户表已就绪');
            });

            db.run(createVideosTable, (err) => {
                if (err) {
                    console.error('创建视频表错误:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ 视频表已就绪');
            });

            db.run(createVideoAnalysisTable, (err) => {
                if (err) {
                    console.error('创建视频分析表错误:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ 视频分析表已就绪');
            });

            db.run(createAnalysisQueueTable, (err) => {
                if (err) {
                    console.error('创建分析队列表错误:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ 分析队列表已就绪');
            });
            db.run(createAnalysisStatsTable, (err) => {
                if (err) {
                    console.error('创建分析统计表错误:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ 分析统计表已就绪');
            });

            db.run(createAnalysisEventsTable, (err) => {
                if (err) {
                    console.error('创建分析事件表错误:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ 分析事件表已就绪');
                resolve();
            });
        });
    });
}

export function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

export function getUserById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, username, email, created_at FROM users WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

export function createUser(username, password, email) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
            [username, password, email],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, username, email });
            }
        );
    });
}

export function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all('SELECT id, username, email, created_at FROM users', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// 新增视频相关的数据库操作函数
export function createVideoRecord(videoData) {
    return new Promise((resolve, reject) => {
        const {
            filename, original_name, file_path, file_size, mime_type,
            user_id, title, description, duration = 0
        } = videoData;

        console.log('💾 创建视频记录，数据:', {
            filename, original_name, file_size, user_id, title
        });

        // 确保所有必需字段都有值
        if (!filename || !original_name || !file_path || !file_size || !mime_type || !user_id) {
            const error = new Error('缺少必需的视频数据字段');
            console.error('❌ 视频数据验证失败:', {
                filename, original_name, file_path, file_size, mime_type, user_id
            });
            reject(error);
            return;
        }

        db.run(
            `INSERT INTO videos 
             (filename, original_name, file_path, file_size, mime_type, user_id, title, description, duration) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [filename, original_name, file_path, file_size, mime_type, user_id, title, description, duration],
            function (err) {
                if (err) {
                    console.error('❌ 数据库插入错误:', err);
                    reject(err);
                } else {
                    const result = {
                        id: this.lastID,
                        filename,
                        original_name,
                        file_size,
                        duration,
                        status: 'processing'
                    };
                    console.log('✅ 数据库插入成功:', result);
                    resolve(result);
                }
            }
        );
    });
}

export function getVideoById(id) {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT v.*, u.username 
            FROM videos v 
            LEFT JOIN users u ON v.user_id = u.id 
            WHERE v.id = ?
        `, [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

export function getVideosByUserId(userId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT v.*, u.username 
            FROM videos v 
            LEFT JOIN users u ON v.user_id = u.id 
            WHERE v.user_id = ? 
            ORDER BY v.created_at DESC
        `, [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

export function getAllVideos(limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT v.*, u.username 
            FROM videos v 
            LEFT JOIN users u ON v.user_id = u.id 
            WHERE v.status = 'ready'
            ORDER BY v.created_at DESC 
            LIMIT ? OFFSET ?
        `, [limit, offset], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}


export function updateVideoAnalysis(videoId, analysisData) {
    return new Promise((resolve, reject) => {
        console.log(`💾 更新视频分析数据: ${videoId}`, {
            status: analysisData.status,
            hasResult: !!analysisData.result
        });

        const query = `
            UPDATE videos 
            SET analysis_result = ?, 
                analysis_status = ?,
                analyzed_at = ?,
                status = ?,
                error_message = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        // 确保分析结果被正确序列化
        const analysisResultJson = analysisData.result ?
            JSON.stringify(analysisData.result) : null;

        const params = [
            analysisResultJson,
            analysisData.status,
            analysisData.analyzed_at || new Date(),
            analysisData.status === 'completed' ? 'ready' : 'error',
            analysisData.error || null,
            videoId
        ];

        console.log('📊 执行SQL参数:', {
            videoId,
            status: analysisData.status,
            hasResult: !!analysisResultJson
        });

        db.run(query, params, function (err) {
            if (err) {
                console.error('❌ 更新视频分析错误:', err);
                reject(err);
            } else {
                console.log(`✅ 视频分析更新成功: ${videoId}, 影响行数: ${this.changes}`);
                resolve({ updated: this.changes });
            }
        });
    });
}

export function updateVideoStatus(videoId, status, thumbnailPath = null) {
    return new Promise((resolve, reject) => {
        const query = thumbnailPath ?
            `UPDATE videos SET status = ?, thumbnail_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?` :
            `UPDATE videos SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

        const params = thumbnailPath ? [status, thumbnailPath, videoId] : [status, videoId];

        db.run(query, params, function (err) {
            if (err) {
                console.error('❌ 更新视频状态错误:', err);
                reject(err);
            } else {
                console.log(`✅ 视频状态更新成功: ${videoId} -> ${status}, 影响行数: ${this.changes}`);
                resolve({ updated: this.changes });
            }
        });
    });
}
export function createVideoAnalysisDetail(analysisDetail) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT INTO video_analysis 
            (video_id, scene_count, object_count, emotion_analysis, content_summary, 
             timeline_analysis, tags, categories, confidence_score, resolution, 
             frame_rate, quality_score, analysis_version, analysis_duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            analysisDetail.video_id,
            analysisDetail.scene_count || 0,
            analysisDetail.object_count || 0,
            analysisDetail.emotion_analysis ? JSON.stringify(analysisDetail.emotion_analysis) : null,
            analysisDetail.content_summary,
            analysisDetail.timeline_analysis ? JSON.stringify(analysisDetail.timeline_analysis) : null,
            analysisDetail.tags ? JSON.stringify(analysisDetail.tags) : null,
            analysisDetail.categories ? JSON.stringify(analysisDetail.categories) : null,
            analysisDetail.confidence_score || 0,
            analysisDetail.resolution,
            analysisDetail.frame_rate,
            analysisDetail.quality_score || 0,
            analysisDetail.analysis_version || '1.0',
            analysisDetail.analysis_duration || 0
        ];

        db.run(query, params, function (err) {
            if (err) {
                console.error('❌ 创建视频分析详情错误:', err);
                reject(err);
            } else {
                resolve({ id: this.lastID });
            }
        });
    });
}

export function addToAnalysisQueue(queueItem) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT INTO analysis_queue 
            (video_id, status, priority, callback_url)
            VALUES (?, ?, ?, ?)
        `;

        const params = [
            queueItem.video_id,
            queueItem.status || 'pending',
            queueItem.priority || 1,
            queueItem.callback_url
        ];

        db.run(query, params, function (err) {
            if (err) {
                console.error('❌ 添加到分析队列错误:', err);
                reject(err);
            } else {
                resolve({ id: this.lastID });
            }
        });
    });
}

// models/db.js - 新增查询函数

/**
 * 获取视频的完整分析信息
 */
export function getVideoAnalysis(videoId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                v.*,
                u.username,
                va.*,
                aq.status as queue_status
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN video_analysis va ON v.id = va.video_id
            LEFT JOIN analysis_queue aq ON v.id = aq.video_id
            WHERE v.id = ?
        `;

        db.get(query, [videoId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

/**
 * 获取所有视频（包含分析信息）- 已存在，但确保包含所有必要字段
 */
export function getVideosWithAnalysis(limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                v.*,
                u.username,
                va.scene_count,
                va.object_count,
                va.confidence_score,
                va.tags,
                va.categories,
                va.emotion_analysis,
                va.content_summary,
                aq.status as queue_status
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN video_analysis va ON v.id = va.video_id
            LEFT JOIN analysis_queue aq ON v.id = aq.video_id
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `;

        db.all(query, [limit, offset], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // 解析JSON字段
                const videos = rows.map(row => ({
                    ...row,
                    analysis_result: row.analysis_result ? JSON.parse(row.analysis_result) : null,
                    tags: row.tags ? JSON.parse(row.tags) : [],
                    categories: row.categories ? JSON.parse(row.categories) : [],
                    emotion_analysis: row.emotion_analysis ? JSON.parse(row.emotion_analysis) : null
                }));
                resolve(videos);
            }
        });
    });
}

/**
 * 按视频状态获取视频列表
 */
export function getVideosByStatus(status, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT v.*, u.username, va.scene_count, va.object_count, va.confidence_score
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN video_analysis va ON v.id = va.video_id
            WHERE v.status = ?
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `;

        db.all(query, [status, limit, offset], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // 解析JSON字段
                const videos = rows.map(row => ({
                    ...row,
                    analysis_result: row.analysis_result ? JSON.parse(row.analysis_result) : null,
                    tags: row.tags ? JSON.parse(row.tags) : [],
                    categories: row.categories ? JSON.parse(row.categories) : []
                }));
                resolve(videos);
            }
        });
    });
}

/**
 * 按分析状态获取视频
 */
export function getVideosByAnalysisStatus(analysisStatus, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT v.*, u.username, va.scene_count, va.object_count, va.confidence_score
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN video_analysis va ON v.id = va.video_id
            WHERE v.analysis_status = ?
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `;

        db.all(query, [analysisStatus, limit, offset], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // 解析JSON字段
                const videos = rows.map(row => ({
                    ...row,
                    analysis_result: row.analysis_result ? JSON.parse(row.analysis_result) : null,
                    tags: row.tags ? JSON.parse(row.tags) : [],
                    categories: row.categories ? JSON.parse(row.categories) : []
                }));
                resolve(videos);
            }
        });
    });
}

/**
 * 获取用户的所有视频（包含分析信息）
 */
export function getUserVideosWithAnalysis(userId, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                v.*,
                u.username,
                va.scene_count,
                va.object_count,
                va.confidence_score,
                va.tags,
                va.categories,
                va.emotion_analysis,
                va.content_summary
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN video_analysis va ON v.id = va.video_id
            WHERE v.user_id = ?
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `;

        db.all(query, [userId, limit, offset], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // 解析JSON字段
                const videos = rows.map(row => ({
                    ...row,
                    analysis_result: row.analysis_result ? JSON.parse(row.analysis_result) : null,
                    tags: row.tags ? JSON.parse(row.tags) : [],
                    categories: row.categories ? JSON.parse(row.categories) : [],
                    emotion_analysis: row.emotion_analysis ? JSON.parse(row.emotion_analysis) : null
                }));
                resolve(videos);
            }
        });
    });
}

/**
 * 搜索视频（按标题、描述、用户名）
 */
export function searchVideos(searchTerm, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                v.*,
                u.username,
                va.scene_count,
                va.object_count,
                va.confidence_score
            FROM videos v
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN video_analysis va ON v.id = va.video_id
            WHERE v.title LIKE ? OR v.description LIKE ? OR u.username LIKE ?
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const searchPattern = `%${searchTerm}%`;

        db.all(query, [searchPattern, searchPattern, searchPattern, limit, offset], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // 解析JSON字段
                const videos = rows.map(row => ({
                    ...row,
                    analysis_result: row.analysis_result ? JSON.parse(row.analysis_result) : null,
                    tags: row.tags ? JSON.parse(row.tags) : [],
                    categories: row.categories ? JSON.parse(row.categories) : []
                }));
                resolve(videos);
            }
        });
    });
}

/**
 * 获取视频统计信息
 */
export function getVideoStats() {
    return new Promise((resolve, reject) => {
        const queries = {
            totalVideos: `SELECT COUNT(*) as count FROM videos`,
            byStatus: `SELECT status, COUNT(*) as count FROM videos GROUP BY status`,
            byAnalysisStatus: `SELECT analysis_status, COUNT(*) as count FROM videos GROUP BY analysis_status`,
            byUser: `SELECT u.username, COUNT(*) as count FROM videos v JOIN users u ON v.user_id = u.id GROUP BY u.username`
        };

        db.serialize(() => {
            const stats = {};

            // 总视频数
            db.get(queries.totalVideos, (err, row) => {
                if (err) reject(err);
                stats.total = row.count;
            });

            // 按状态统计
            db.all(queries.byStatus, (err, rows) => {
                if (err) reject(err);
                stats.byStatus = {};
                rows.forEach(row => {
                    stats.byStatus[row.status] = row.count;
                });
            });

            // 按分析状态统计
            db.all(queries.byAnalysisStatus, (err, rows) => {
                if (err) reject(err);
                stats.byAnalysisStatus = {};
                rows.forEach(row => {
                    stats.byAnalysisStatus[row.analysis_status] = row.count;
                });
            });

            // 按用户统计
            db.all(queries.byUser, (err, rows) => {
                if (err) reject(err);
                stats.byUser = {};
                rows.forEach(row => {
                    stats.byUser[row.username] = row.count;
                });

                // 所有查询完成后解析
                resolve(stats);
            });
        });
    });
}

/**
 * 更新视频处理进度
 */
export function updateVideoProgress(videoId, progress) {
    return new Promise((resolve, reject) => {
        const query = `
            UPDATE videos 
            SET processing_progress = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        db.run(query, [progress, videoId], function (err) {
            if (err) {
                console.error('❌ 更新视频进度错误:', err);
                reject(err);
            } else {
                console.log(`✅ 视频进度更新: ${videoId} -> ${progress}%`);
                resolve({ updated: this.changes });
            }
        });
    });
}
/**
 * 附加分析输出的数据库文件
 */
export function attachAnalysisDatabase(videoId) {
    return new Promise((resolve, reject) => {
        const analysisDbPath = `C:\\Users\\14804\\Desktop\\PROJECE_ONE\\ptProcess\\analysis_output\\${videoId}\\video_stats.db`;

        // 使用 ATTACH DATABASE 命令附加外部数据库:cite[5]
        const attachQuery = `ATTACH DATABASE '${analysisDbPath}' AS analysis_db`;

        db.run(attachQuery, function (err) {
            if (err) {
                console.error(`❌ 附加分析数据库失败: ${videoId}`, err);
                reject(err);
            } else {
                console.log(`✅ 分析数据库附加成功: ${videoId}`);
                resolve(true);
            }
        });
    });
}

/**
 * 分离附加的数据库
 */
export function detachAnalysisDatabase() {
    return new Promise((resolve, reject) => {
        db.run('DETACH DATABASE analysis_db', function (err) {
            if (err) {
                console.error('❌ 分离分析数据库失败', err);
                reject(err);
            } else {
                console.log('✅ 分析数据库分离成功');
                resolve(true);
            }
        });
    });
}

/**
 * 从分析数据库导入视频统计数据
 */
export async function importVideoStatsFromAnalysisDB(videoId) {
    try {
        console.log(`📊 开始导入分析数据库数据: ${videoId}`);

        // 附加分析数据库
        await attachAnalysisDatabase(videoId);

        // 1. 从分析数据库的 videos 表读取数据
        const videoStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT video_name, fps, total_frame 
                FROM analysis_db.videos 
                WHERE video_id = 1
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // 2. 从分析数据库的 events 表读取数据
        const eventsData = await new Promise((resolve, reject) => {
            db.all(`
                SELECT label, start_frame, duration_frames, disappear_frame 
                FROM analysis_db.events 
                WHERE video_id = 1
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        console.log(`📋 读取到分析数据:`, {
            videoStats,
            eventsCount: eventsData.length
        });

        // 3. 构建分析结果对象
        const analysisResult = {
            source: 'analysis_db',
            video_info: videoStats,
            events: eventsData,
            imported_at: new Date().toISOString()
        };

        // 4. 更新主数据库中的分析结果
        await updateVideoAnalysis(videoId, {
            status: 'completed',
            result: analysisResult,
            analyzed_at: new Date()
        });

        // 5. 分离分析数据库
        await detachAnalysisDatabase();

        console.log(`✅ 分析数据库数据导入完成: ${videoId}`);
        return analysisResult;

    } catch (error) {
        console.error(`❌ 导入分析数据库数据失败: ${videoId}`, error);
        // 确保在出错时也分离数据库
        try {
            await detachAnalysisDatabase();
        } catch (detachError) {
            console.error('分离数据库失败:', detachError);
        }
        throw error;
    }
}

export async function copyAnalysisDatabase(videoId) {
    return new Promise(async (resolve, reject) => {
        try {
            const analysisDbPath = `C:\\\\Users\\\\14804\\\\Desktop\\\\PROJECE_ONE\\\\ptProcess\\\\analysis_output\\\\${videoId}\\\\video_stats.db`;

            console.log(`🔄 开始复制分析数据库: ${analysisDbPath}`);

            // 检查分析数据库文件是否存在
            if (!await fs.pathExists(analysisDbPath)) {
                throw new Error(`分析数据库文件不存在: ${analysisDbPath}`);
            }

            // 使用 ATTACH DATABASE 附加分析数据库
            const attachQuery = `ATTACH DATABASE '${analysisDbPath}' AS analysis_db`;

            db.run(attachQuery, async (attachErr) => {
                if (attachErr) {
                    console.error(`❌ 附加分析数据库失败: ${videoId}`, attachErr);
                    reject(attachErr);
                    return;
                }

                console.log(`✅ 分析数据库附加成功: ${videoId}`);

                try {
                    // 开始事务
                    await new Promise((resolve, reject) => {
                        db.run('BEGIN TRANSACTION', (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    // 1. 复制 videos 表数据到 analysis_stats
                    const copyVideosQuery = `
                        INSERT OR REPLACE INTO analysis_stats (video_id, video_name, fps, total_frame)
                        SELECT ?, video_name, fps, total_frame 
                        FROM analysis_db.videos 
                        WHERE video_id = 1
                    `;

                    await new Promise((resolve, reject) => {
                        db.run(copyVideosQuery, [videoId], function (err) {
                            if (err) reject(err);
                            else {
                                console.log(`✅ 复制视频统计数据: ${this.changes} 条记录`);
                                resolve();
                            }
                        });
                    });

                    // 2. 复制 events 表数据到 analysis_events
                    const copyEventsQuery = `
                        INSERT INTO analysis_events (video_id, label, start_frame, duration_frames, disappear_frame)
                        SELECT ?, label, start_frame, duration_frames, disappear_frame 
                        FROM analysis_db.events 
                        WHERE video_id = 1
                    `;

                    await new Promise((resolve, reject) => {
                        db.run(copyEventsQuery, [videoId], function (err) {
                            if (err) reject(err);
                            else {
                                console.log(`✅ 复制事件数据: ${this.changes} 条记录`);
                                resolve();
                            }
                        });
                    });

                    // 提交事务
                    await new Promise((resolve, reject) => {
                        db.run('COMMIT', (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    console.log(`🎉 分析数据库复制完成: ${videoId}`);

                    // 分离分析数据库
                    await new Promise((resolve, reject) => {
                        db.run('DETACH DATABASE analysis_db', (err) => {
                            if (err) {
                                console.error('分离分析数据库失败', err);
                                // 不阻断主流程
                            }
                            resolve();
                        });
                    });

                    resolve({
                        success: true,
                        videoId,
                        statsCopied: true,
                        eventsCopied: true
                    });

                } catch (transactionError) {
                    // 回滚事务
                    await new Promise((resolve) => {
                        db.run('ROLLBACK', () => resolve());
                    });

                    // 分离分析数据库
                    await new Promise((resolve) => {
                        db.run('DETACH DATABASE analysis_db', () => resolve());
                    });

                    reject(transactionError);
                }
            });

        } catch (error) {
            console.error(`❌ 复制分析数据库失败: ${videoId}`, error);
            reject(error);
        }
    });
}

/**
 * 获取视频的分析统计信息
 */
export function getVideoAnalysisStats(videoId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                s.*,
                COUNT(e.id) as events_count
            FROM analysis_stats s
            LEFT JOIN analysis_events e ON s.video_id = e.video_id
            WHERE s.video_id = ?
            GROUP BY s.id
        `;

        db.get(query, [videoId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

/**
 * 获取视频的分析事件列表
 */
export function getVideoAnalysisEvents(videoId, limit = 100, offset = 0) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT * FROM analysis_events 
            WHERE video_id = ? 
            ORDER BY start_frame ASC
            LIMIT ? OFFSET ?
        `;

        db.all(query, [videoId, limit, offset], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

/**
 * 检查分析数据是否已存在
 */
export function checkAnalysisDataExists(videoId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as count 
            FROM analysis_stats 
            WHERE video_id = ?
        `;

        db.get(query, [videoId], (err, row) => {
            if (err) reject(err);
            else resolve(row.count > 0);
        });
    });
}

/**
 * 删除视频的分析数据
 */
export function deleteVideoAnalysisData(videoId) {
    return new Promise((resolve, reject) => {
        // 开始事务
        db.run('BEGIN TRANSACTION', (beginErr) => {
            if (beginErr) {
                reject(beginErr);
                return;
            }

            // 先删除事件数据（由于外键约束）
            db.run('DELETE FROM analysis_events WHERE video_id = ?', [videoId], function (eventsErr) {
                if (eventsErr) {
                    db.run('ROLLBACK', () => reject(eventsErr));
                    return;
                }

                const eventsDeleted = this.changes;

                // 然后删除统计数据
                db.run('DELETE FROM analysis_stats WHERE video_id = ?', [videoId], function (statsErr) {
                    if (statsErr) {
                        db.run('ROLLBACK', () => reject(statsErr));
                        return;
                    }

                    const statsDeleted = this.changes;

                    // 提交事务
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                            reject(commitErr);
                        } else {
                            resolve({
                                eventsDeleted,
                                statsDeleted,
                                totalDeleted: eventsDeleted + statsDeleted
                            });
                        }
                    });
                });
            });
        });
    });
}