import { verifyToken } from '../auth.js';

export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN


    if (!token) {
        return res.status(401).json({ error: '访问令牌缺失' });
    }

    const user = verifyToken(token);

    if (!user) {
        return res.status(403).json({ error: '令牌无效或已过期' });
    }

    // 确保用户对象包含必要的属性
    if (!user.id) {
        console.error('❌ JWT令牌缺少用户ID:', user);
        return res.status(403).json({ error: '令牌中的用户信息不完整' });
    }

    req.user = user;
    next();
}

// 可选认证中间件（用于某些可选的用户功能）
export function optionalAuthenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        const user = verifyToken(token);
        if (user) {
            req.user = user;
        }
    }

    next();
}