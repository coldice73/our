import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getUserByUsername, createUser } from './models/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-2024';

export async function registerUser(username, password, email) {
    // 验证输入
    if (!username || !password) {
        throw new Error('用户名和密码是必填的');
    }

    if (username.length < 3) {
        throw new Error('用户名至少需要3个字符');
    }

    if (password.length < 6) {
        throw new Error('密码至少需要6个字符');
    }

    // 检查用户是否已存在
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
        throw new Error('用户名已存在');
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 12);

    // 创建用户
    const user = await createUser(username, hashedPassword, email);

    // 生成JWT令牌
    const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    return {
        message: '注册成功',
        user: { id: user.id, username: user.username, email: user.email },
        token
    };
}

export async function loginUser(username, password) {
    // 验证输入
    if (!username || !password) {
        throw new Error('用户名和密码是必填的');
    }

    // 查找用户
    const user = await getUserByUsername(username);
    if (!user) {
        throw new Error('用户不存在');
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
        throw new Error('密码错误');
    }

    // 生成JWT令牌
    const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    return {
        message: '登录成功',
        user: { id: user.id, username: user.username, email: user.email },
        token
    };
}

export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // 确保返回的对象包含id属性
        if (!decoded.id) {
            console.error('JWT令牌缺少用户ID:', decoded);
            return null;
        }
        return decoded;
    } catch (error) {
        console.error('令牌验证失败:', error);
        return null;
    }
}