#!/bin/bash

# Tidyflux 构建脚本
# 自动压缩代码并生成 docker 部署文件

set -e  # 遇到错误立即退出

echo "🚀 开始构建 Tidyflux..."

# 项目根目录
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/docker/dist"

# 清理旧的构建
echo "📦 清理旧构建..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/www/js" "$DIST_DIR/www/icons" "$DIST_DIR/server/src/routes" "$DIST_DIR/server/src/middleware" "$DIST_DIR/server/src/utils" "$DIST_DIR/server/src/jobs" "$DIST_DIR/server/src/services"

# Generate Build Version
BUILD_VERSION=$(date +%s)
echo "🔒 Build Version: $BUILD_VERSION"

# ========================================
# 前端构建
# ========================================
echo "🎨 压缩 CSS..."
# 合并并压缩所有 CSS 到一个文件（保持原名 style.css）
cat "$ROOT_DIR/www/css/variables.css" \
    "$ROOT_DIR/www/css/base.css" \
    "$ROOT_DIR/www/css/layout.css" \
    "$ROOT_DIR/www/css/article.css" \
    "$ROOT_DIR/www/css/modals.css" \
    "$ROOT_DIR/www/css/auth.css" \
    "$ROOT_DIR/www/css/themes.css" \
    "$ROOT_DIR/www/css/skeleton.css" \
    "$ROOT_DIR/www/css/responsive.css" \
    "$ROOT_DIR/www/css/force-dark.css" \
    "$ROOT_DIR/www/css/force-light.css" \
    | esbuild --loader=css --minify > "$DIST_DIR/www/style-${BUILD_VERSION}.css"

echo "📜 压缩 JavaScript..."
# 打包并压缩主应用 JS (带版本号)
esbuild "$ROOT_DIR/www/js/main.js" --bundle --minify --outfile="$DIST_DIR/www/js/main-${BUILD_VERSION}.js" --format=esm



# 复制独立库文件
mkdir -p "$DIST_DIR/www/js/lib"
cp "$ROOT_DIR/www/js/lib/howler.min.js" "$DIST_DIR/www/js/lib/howler.min.js"

# Copy theme-init.js (with version)
cp "$ROOT_DIR/www/js/theme-init.js" "$DIST_DIR/www/js/theme-init-${BUILD_VERSION}.js"

# 处理 Service Worker (复制并更新缓存列表)
echo "⚡ 处理 Service Worker..."
cp "$ROOT_DIR/www/sw.js" "$DIST_DIR/www/sw.js"

# 创建临时脚本来更新 sw.js 中的缓存列表
cat > "$ROOT_DIR/update_sw.js" << 'JS_EOF'
const fs = require('fs');
const swPath = process.argv[2];
const buildVersion = process.argv[3];

const prodCacheList = [
  '/',
  '/index.html',
  `/style-${buildVersion}.css`,
  `/js/main-${buildVersion}.js`,
  `/js/theme-init-${buildVersion}.js`,
  '/js/lib/howler.min.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png'
];

try {
  let content = fs.readFileSync(swPath, 'utf8');
  // 匹配 const URLS_TO_CACHE = [...]
  const regex = /const\s+URLS_TO_CACHE\s*=\s*\[[\s\S]*?\];/;
  
  if (!regex.test(content)) {
    console.error('❌ Error: Could not find URLS_TO_CACHE in sw.js');
    process.exit(1);
  }
  
  // Replace Cache List
  let newContent = content.replace(regex, `const URLS_TO_CACHE = ${JSON.stringify(prodCacheList, null, 2)};`);

  // Replace Cache Name with Build Version
  const cacheNameRegex = /const\s+CACHE_NAME\s*=\s*['"`].*?['"`];/;
  newContent = newContent.replace(cacheNameRegex, `const CACHE_NAME = 'tidyflux-cache-v${buildVersion}';`);

  fs.writeFileSync(swPath, newContent);
  console.log('✅ Updated sw.js cache list and version');
} catch (error) {
  console.error('❌ Failed to update sw.js:', error);
  process.exit(1);
}
JS_EOF

# 执行更新脚本
node "$ROOT_DIR/update_sw.js" "$DIST_DIR/www/sw.js" "$BUILD_VERSION"
rm "$ROOT_DIR/update_sw.js"

echo "📄 处理 index.html..."
# Copy and Rewrite index.html references
sed "s|/style.css|/style-${BUILD_VERSION}.css|g" "$ROOT_DIR/www/index.html" | \
sed "s|/js/main.js|/js/main-${BUILD_VERSION}.js|g" | \
sed "s|/js/theme-init.js|/js/theme-init-${BUILD_VERSION}.js|g" > "$DIST_DIR/www/index.html"

# 复制静态资源
echo "📁 复制静态资源..."
cp -r "$ROOT_DIR/www/icons/"* "$DIST_DIR/www/icons/"
cp "$ROOT_DIR/www/manifest.json" "$DIST_DIR/www/"

# ========================================
# 后端构建
# ========================================
echo "⚙️ 压缩后端代码..."

# 压缩主入口
esbuild "$ROOT_DIR/server/src/index.js" --minify --outfile="$DIST_DIR/server/src/index.js" --platform=node --format=esm 2>/dev/null || cp "$ROOT_DIR/server/src/index.js" "$DIST_DIR/server/src/index.js"

# 压缩其他模块
for f in "$ROOT_DIR/server/src/"*.js; do
    [ -f "$f" ] && [ "$(basename "$f")" != "index.js" ] && {
        esbuild "$f" --minify --outfile="$DIST_DIR/server/src/$(basename "$f")" --platform=node --format=esm 2>/dev/null || cp "$f" "$DIST_DIR/server/src/$(basename "$f")"
    }
done

for f in "$ROOT_DIR/server/src/routes/"*.js; do
    [ -f "$f" ] && {
        esbuild "$f" --minify --outfile="$DIST_DIR/server/src/routes/$(basename "$f")" --platform=node --format=esm 2>/dev/null || cp "$f" "$DIST_DIR/server/src/routes/$(basename "$f")"
    }
done

for f in "$ROOT_DIR/server/src/middleware/"*.js; do
    [ -f "$f" ] && {
        esbuild "$f" --minify --outfile="$DIST_DIR/server/src/middleware/$(basename "$f")" --platform=node --format=esm 2>/dev/null || cp "$f" "$DIST_DIR/server/src/middleware/$(basename "$f")"
    }
done

for f in "$ROOT_DIR/server/src/utils/"*.js; do
    [ -f "$f" ] && {
        esbuild "$f" --minify --outfile="$DIST_DIR/server/src/utils/$(basename "$f")" --platform=node --format=esm 2>/dev/null || cp "$f" "$DIST_DIR/server/src/utils/$(basename "$f")"
    }
done

for f in "$ROOT_DIR/server/src/jobs/"*.js; do
    [ -f "$f" ] && {
        esbuild "$f" --minify --outfile="$DIST_DIR/server/src/jobs/$(basename "$f")" --platform=node --format=esm 2>/dev/null || cp "$f" "$DIST_DIR/server/src/jobs/$(basename "$f")"
    }
done

for f in "$ROOT_DIR/server/src/services/"*.js; do
    [ -f "$f" ] && {
        esbuild "$f" --minify --outfile="$DIST_DIR/server/src/services/$(basename "$f")" --platform=node --format=esm 2>/dev/null || cp "$f" "$DIST_DIR/server/src/services/$(basename "$f")"
    }
done

# 复制 package 文件
cp "$ROOT_DIR/server/package.json" "$ROOT_DIR/server/package-lock.json" "$DIST_DIR/server/"

# 清理 .DS_Store
find "$DIST_DIR" -name ".DS_Store" -delete

# ========================================
# 完成
# ========================================
echo ""
echo "✅ 构建完成！"
echo ""
echo "📊 文件大小对比："
echo "   原始前端: $(du -sh "$ROOT_DIR/www" | cut -f1)"
echo "   压缩后:   $(du -sh "$DIST_DIR/www" | cut -f1)"
echo ""
echo "📁 输出目录: $DIST_DIR"
