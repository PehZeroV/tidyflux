# Stage 1: Build
FROM node:20-alpine AS builder

# 安装构建工具（含 better-sqlite3 原生编译需要的工具链）
RUN apk add --no-cache bash python3 make g++ && npm install -g esbuild

WORKDIR /app

# 复制源码
COPY . .

# 赋予脚本执行权限并运行构建
RUN chmod +x build.sh && ./build.sh

# Stage 2: Production
FROM node:20-alpine

# better-sqlite3 需要编译原生模块
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 从 builder 阶段复制构建产物
COPY --from=builder /app/docker/dist /app

# 进入 server 目录安装生产依赖
WORKDIR /app/server
RUN npm ci --production && apk del python3 make g++

# 设置环境变量端口
ENV PORT=8812

# 暴露端口
EXPOSE 8812

# 启动命令
CMD ["node", "src/index.js"]
