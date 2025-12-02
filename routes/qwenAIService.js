// services/qwenAIService.js
import OpenAI from "openai";

class QwenAIService {
    constructor() {
        this.apiKey = "sk-d876c9a188684d21bb850fd186569262"; // 修改环境变量名
        if (!this.apiKey) {
            console.error('❌ DASHSCOPE_API_KEY 环境变量未设置');
        }

        // 初始化 OpenAI 客户端
        this.client = new OpenAI({
            // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
            // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
            apiKey: this.apiKey,
            // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
            baseURL: process.env.QWENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
        });
    }

    /**
         * 发送视频分析结果到QwenAI进行深度分析 - 直接返回结果，不保存到数据库
         */
    async analyzeVideoWithQwen(videoAnalysisData, analysisType = 'summary') {
        try {
            console.log(`🤖 开始QwenAI分析，视频ID: ${videoAnalysisData.id}, 分析类型: ${analysisType}`);

            // 检查API密钥
            if (!this.apiKey) {
                throw new Error('DASHSCOPE_API_KEY 未配置');
            }

            // 构建提示词
            const prompt = this.buildAnalysisPrompt(videoAnalysisData, analysisType);

            console.log('📤 发送QwenAI请求...');

            // 使用 OpenAI SDK 调用百炼API
            const completion = await this.client.chat.completions.create({
                model: "qwen-plus",
                messages: [
                    {
                        role: "system",
                        content: "你是一个专业的视频内容分析师，擅长从技术数据和内容特征中提取有价值的洞察。注意，生成内容是以纯粹的文本即可，不要返回md格式"
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7,
                top_p: 0.8,
                max_tokens: 2000
            });

            // 正确解析响应
            if (completion.choices && completion.choices[0]) {
                const aiAnalysis = completion.choices[0].message.content;
                const usage = completion.usage;

                console.log('✅ QwenAI分析完成，直接返回结果给前端');

                // 删除数据库保存代码
                /*
                try {
                    await saveQwenAnalysisResult({
                        video_id: videoAnalysisData.id,
                        analysis_type: analysisType,
                        qwen_response: aiAnalysis,
                        usage_data: usage
                    });
                    console.log('💾 QwenAI分析结果已保存到数据库');
                } catch (dbError) {
                    console.error('❌ 保存QwenAI分析结果到数据库失败:', dbError);
                }
                */

                return {
                    success: true,
                    analysis: aiAnalysis,
                    usage: usage
                };
            } else {
                console.error('❌ QwenAI响应格式异常:', completion);
                throw new Error('QwenAI响应格式异常');
            }

        } catch (error) {
            console.error('❌ QwenAI分析失败:');
            console.error('错误信息:', error.message);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 批量分析多个视频 - 直接返回结果，不保存到数据库
     */
    async batchAnalyzeVideos(videosData, analysisType = 'summary') {
        const results = [];
        const BATCH_DELAY = 2000;

        for (const [index, videoData] of videosData.entries()) {
            try {
                console.log(`🔄 处理第 ${index + 1}/${videosData.length} 个视频: ${videoData.title}`);

                // 添加延迟避免速率限制
                if (index > 0) {
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                }

                const result = await this.analyzeVideoWithQwen(videoData, analysisType);
                results.push({
                    videoId: videoData.id,
                    videoTitle: videoData.title,
                    success: result.success,
                    analysis: result.analysis,
                    error: result.error,
                    usage: result.usage
                });
            } catch (error) {
                console.error(`❌ 处理视频 ${videoData.id} 失败:`, error.message);
                results.push({
                    videoId: videoData.id,
                    videoTitle: videoData.title,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }


    /**
     * 批量分析多个视频
     */
    async batchAnalyzeVideos(videosData, analysisType = 'summary') {
        const results = [];
        const BATCH_DELAY = 2000; // 增加到2秒延迟，避免速率限制

        for (const [index, videoData] of videosData.entries()) {
            try {
                console.log(`🔄 处理第 ${index + 1}/${videosData.length} 个视频: ${videoData.title}`);

                // 添加延迟避免速率限制
                if (index > 0) {
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                }

                const result = await this.analyzeVideoWithQwen(videoData, analysisType);
                results.push({
                    videoId: videoData.id,
                    videoTitle: videoData.title,
                    success: result.success,
                    analysis: result.analysis,
                    error: result.error,
                    savedToDB: result.savedToDB,
                    usage: result.usage
                });
            } catch (error) {
                console.error(`❌ 处理视频 ${videoData.id} 失败:`, error.message);
                results.push({
                    videoId: videoData.id,
                    videoTitle: videoData.title,
                    success: false,
                    error: error.message,
                    savedToDB: false
                });
            }
        }

        return results;
    }

    buildAnalysisPrompt(videoData, analysisType) {
        // 保持原有的提示词构建逻辑
        const { analysis_result, scene_count, object_count, tags, categories, duration, title } = videoData;

        let specificInstruction = '';

        switch (analysisType) {
            case 'summary':
                specificInstruction = `视频内容为VR的第一人场景视角，请为这个视频生成一个专业的内容总结报告，包括主要内容、关键场景和整体评价。注意，生成内容是以纯粹的文本即可，不要返回md格式，忽略元数据标注“0秒”`;
                break;
            case 'medical':
                specificInstruction = `视频内容为VR的第一人场景视角，作为医学影像分析专家，请分析这个细胞视频，提供专业的医学观察和建议。注意，生成内容是以纯粹的文本即可，不要返回md格式，忽略元数据标注“0秒”`;
                break;
            case 'technical':
                specificInstruction = `视频内容为VR的第一人场景视角，从技术角度分析这个视频的质量特征、拍摄技术和改进建议。注意，生成内容是以纯粹的文本即可，不要返回md格式，忽略元数据标注“0秒”`;
                break;
            default:
                specificInstruction = '视频内容为VR的第一人场景视角，请对这个视频内容进行全面的专业分析。注意，生成内容是以纯粹的文本即可，不要返回md格式，忽略元数据标注“0秒”';
        }

        return `
视频分析数据深度解读请求：

视频基本信息：
- 标题: ${title || '未命名'}
- 时长: ${duration || 0}秒
- 场景数量: ${scene_count || 0}
- 检测到对象数量: ${object_count || 0}
- 标签: ${tags ? (Array.isArray(tags) ? tags.join(', ') : tags) : '无'}
- 分类: ${categories ? (Array.isArray(categories) ? categories.join(', ') : categories) : '无'}

详细分析结果：
${analysis_result ? JSON.stringify(analysis_result, null, 2) : '无'}

${specificInstruction}

请用中文回复，保持专业但易于理解。`;
    }
}

export default new QwenAIService();