# AI模型对比工具

一个简单的AI模型对比工具，支持同时调用两个不同的AI模型进行对比测试。

## 功能特性

- 双模型并行对比
- 流式输出显示
- 思考模式支持
- 多API提供商支持（OpenAI、Anthropic、自定义）
- 配置持久化
- CORS代理支持

## 快速开始

1. 直接在浏览器中打开 `index.html`
2. 配置两个AI模型的API信息
3. 输入提示词，点击发送即可对比

## CORS问题解决方案

### 问题说明

浏览器的同源策略会阻止前端直接调用第三方API，导致CORS错误：
```
Access to fetch at 'https://api.openai.com/...' has been blocked by CORS policy
```

### 解决方案一：使用公共CORS代理（推荐）

**步骤：**

1. 打开配置面板
2. 在"全局配置"中填入CORS代理地址
3. 保存配置

**可用的公共代理：**

- `https://cors-anywhere.herokuapp.com/`
- `https://api.allorigins.win/raw?url=`

**注意：** 公共代理可能有请求限制或不稳定，生产环境建议使用方案二。

### 解决方案二：自建本地代理（稳定）

**步骤：**

1. 确保已安装Node.js

2. 在项目目录打开终端，运行：
   ```bash
   node proxy-server.js
   ```

3. 看到提示信息：
   ```
   CORS代理服务器运行在 http://localhost:8080/
   ```

4. 在配置面板的"CORS代理地址"中填入：
   ```
   http://localhost:8080/
   ```

5. 保存配置，正常使用

**工作原理：**
本地代理服务器会转发所有请求到目标API，并添加正确的CORS头，绕过浏览器的同源策略限制。

### 解决方案三：浏览器扩展（仅开发环境）

安装CORS扩展临时禁用CORS检查：
- Chrome: "Allow CORS: Access-Control-Allow-Origin"
- Firefox: "CORS Everywhere"

**警告：** 此方案仅适用于开发测试，不要在生产环境使用。

## 配置说明

### API提供商配置

**OpenAI格式：**
- API地址：`https://api.openai.com/v1/chat/completions`
- 模型示例：`gpt-4`、`gpt-4-turbo`、`gpt-3.5-turbo`
- 思考模式：o1系列模型支持

**Anthropic格式：**
- API地址：`https://api.anthropic.com/v1/messages`
- 模型示例：`claude-3-opus-20240229`、`claude-3-sonnet-20240229`
- 思考模式：Claude 3.5+模型支持

**自定义API：**
- 支持兼容OpenAI或Anthropic格式的第三方API
- 需要手动填入完整的API地址

### 思考模式

启用思考模式后，AI会显示内部思考过程：
- Anthropic：显示thinking内容
- OpenAI o1：显示reasoning过程

## 技术架构

- 纯HTML/CSS/JavaScript实现
- 无需构建工具
- 使用fetch API处理流式响应
- localStorage持久化配置

## 文件结构

```
AI-PK/
├── index.html          # 主页面
├── style.css           # 样式文件
├── app.js              # 核心逻辑
├── proxy-server.js     # 本地代理服务器（可选）
└── README.md           # 说明文档
```

## 注意事项

1. **API密钥安全**
   - 密钥存储在浏览器localStorage中
   - 仅在本地使用，不要在公共环境使用
   - 不要将密钥提交到代码仓库

2. **CORS代理选择**
   - 开发测试：使用公共代理或浏览器扩展
   - 生产环境：使用自建代理服务器
   - 企业环境：部署专用代理服务

3. **流式输出**
   - 需要API支持Server-Sent Events (SSE)
   - 网络不稳定可能导致中断
   - 可随时点击"停止"按钮中断生成

4. **模型兼容性**
   - 确保模型名称正确
   - 不同模型的参数可能不同
   - 思考模式仅部分模型支持

## 常见问题

**Q: 为什么会出现CORS错误？**
A: 浏览器安全策略限制，需要使用代理服务器或CORS扩展解决。

**Q: 公共代理不可用怎么办？**
A: 使用本地代理服务器（proxy-server.js）或浏览器扩展。

**Q: 思考模式没有显示内容？**
A: 确认使用的模型支持思考模式，并且已勾选"启用思考模式"。

**Q: 流式输出中断了怎么办？**
A: 检查网络连接，或尝试重新发送请求。

**Q: 可以同时对比三个或更多模型吗？**
A: 当前版本仅支持两个模型对比，如需更多可修改代码扩展。

## 许可证

MIT License
