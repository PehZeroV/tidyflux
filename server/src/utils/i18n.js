/**
 * Server-side i18n - 服务端国际化
 * 
 * 通过 Accept-Language 请求头判断语言，提供 t(key, lang) 翻译函数
 */

const messages = {
    zh: {
        // ===== middleware/auth =====
        not_logged_in: '未登录',
        session_expired: '登录已过期',
        miniflux_not_configured: 'Miniflux 未配置，请先在设置中完成配置',

        // ===== routes/auth =====
        invalid_credentials_miniflux: '用户名或密码错误，请检查 Miniflux 登录信息',
        connection_failed: '无法连接到 Miniflux，请确认地址和端口正确',
        connection_test_error: '连接测试失败',
        check_url_and_credentials: '请检查 URL 和登录信息',
        fill_all_info: '请填写完整信息',
        invalid_credentials: '用户名或密码错误',
        login_failed: '登录失败',
        register_not_supported: 'Miniflux 模式不支持注册，请直接登录',
        password_change_success: '密码修改成功',
        password_change_failed: '密码修改失败',
        not_configured: '未配置',
        status_check_failed: '状态检查失败',
        fill_miniflux_url: '请填写 Miniflux URL',
        fill_api_key: '请填写 API Key',
        fill_username_password: '请填写用户名和密码',
        config_save_failed: '保存配置失败',
        config_save_success: '配置保存成功',
        connection_test_success: '连接测试成功',
        test_failed: '测试失败',
        env_config_cannot_delete: '环境变量配置无法通过界面删除',
        config_clear_failed: '清除配置失败',
        config_cleared: '配置已清除',

        // ===== routes/articles =====
        fetch_articles_failed: '获取文章失败',
        fetch_integrations_failed: '获取集成状态失败',
        article_not_found: '文章不存在',
        mark_failed: '标记失败',
        batch_mark_failed: '批量标记失败',
        favorite_failed: '收藏失败',
        unfavorite_failed: '取消收藏失败',
        fetch_content_failed: '获取全文失败',
        save_third_party_failed: '保存到第三方服务失败',

        // ===== routes/feeds =====
        discover_failed: '发现订阅失败',
        fetch_feeds_failed: '获取订阅失败',
        feed_not_found: '订阅不存在',
        fetch_feed_detail_failed: '获取订阅详情失败',
        add_feed_failed: '添加订阅失败',
        update_feed_failed: '更新订阅失败',
        delete_feed_failed: '删除订阅失败',
        refresh_failed: '刷新失败',
        refresh_group_failed: '刷新分组失败',
        export_failed: '导出失败',
        import_queued: '导入已排队处理',
        import_failed: '导入失败',

        // ===== routes/groups =====
        fetch_groups_failed: '获取分组失败',
        group_name_required: '分组名称不能为空',
        create_group_failed: '创建分组失败',
        update_group_failed: '更新分组失败',
        delete_group_failed: '删除分组失败',

        // ===== routes/preferences =====
        fetch_preferences_failed: '获取偏好设置失败',
        save_preferences_failed: '保存偏好设置失败',
        update_preferences_failed: '更新偏好设置失败',

        // ===== routes/digest =====
        fetch_digest_list_failed: '获取简报列表失败',
        digest_not_found: '简报不存在',
        fetch_digest_failed: '获取简报失败',
        generate_digest_failed: '生成简报失败',
        delete_failed: '删除失败',
        preview_failed: '预览失败',

        // ===== routes/ai =====
        ai_not_configured_server: 'AI 未在服务端配置',
        provide_api_url_and_key: '请提供完整的 API URL 和 Key',

        // ===== services/digest-service =====
        ai_not_configured: 'AI 未配置，请先在设置中配置 AI API',
        ai_api_error: 'AI API 错误',
        all_subscriptions: '全部订阅',
        today: '今天',
        feed: '订阅源',
        group: '分组',
        no_articles_in_hours: '在过去 {hours} 小时内没有{unread}文章。',
        no_articles_today: '今天没有{unread}文章。',
        unread: '未读',
        digest_word: '简报',

        // ===== utils/digest-store =====
        all: '全部',
    },
    en: {
        // ===== middleware/auth =====
        not_logged_in: 'Not logged in',
        session_expired: 'Session expired',
        miniflux_not_configured: 'Miniflux is not configured. Please complete setup in settings first.',

        // ===== routes/auth =====
        invalid_credentials_miniflux: 'Invalid credentials, please check your Miniflux login info',
        connection_failed: 'Cannot connect to Miniflux, please verify the address and port',
        connection_test_error: 'Connection test failed',
        check_url_and_credentials: 'Please check URL and credentials',
        fill_all_info: 'Please fill in all information',
        invalid_credentials: 'Invalid username or password',
        login_failed: 'Login failed',
        register_not_supported: 'Registration not supported in Miniflux mode, please login directly',
        password_change_success: 'Password changed successfully',
        password_change_failed: 'Password change failed',
        not_configured: 'Not configured',
        status_check_failed: 'Status check failed',
        fill_miniflux_url: 'Please enter Miniflux URL',
        fill_api_key: 'Please enter API Key',
        fill_username_password: 'Please enter username and password',
        config_save_failed: 'Failed to save configuration',
        config_save_success: 'Configuration saved successfully',
        connection_test_success: 'Connection test successful',
        test_failed: 'Test failed',
        env_config_cannot_delete: 'Environment variable configuration cannot be deleted from the UI',
        config_clear_failed: 'Failed to clear configuration',
        config_cleared: 'Configuration cleared',

        // ===== routes/articles =====
        fetch_articles_failed: 'Failed to fetch articles',
        fetch_integrations_failed: 'Failed to fetch integrations status',
        article_not_found: 'Article not found',
        mark_failed: 'Mark failed',
        batch_mark_failed: 'Batch mark failed',
        favorite_failed: 'Favorite failed',
        unfavorite_failed: 'Unfavorite failed',
        fetch_content_failed: 'Failed to fetch full content',
        save_third_party_failed: 'Failed to save to third-party service',

        // ===== routes/feeds =====
        discover_failed: 'Failed to discover feeds',
        fetch_feeds_failed: 'Failed to fetch feeds',
        feed_not_found: 'Feed not found',
        fetch_feed_detail_failed: 'Failed to fetch feed details',
        add_feed_failed: 'Failed to add feed',
        update_feed_failed: 'Failed to update feed',
        delete_feed_failed: 'Failed to delete feed',
        refresh_failed: 'Refresh failed',
        refresh_group_failed: 'Failed to refresh group',
        export_failed: 'Export failed',
        import_queued: 'Import queued for processing',
        import_failed: 'Import failed',

        // ===== routes/groups =====
        fetch_groups_failed: 'Failed to fetch groups',
        group_name_required: 'Group name is required',
        create_group_failed: 'Failed to create group',
        update_group_failed: 'Failed to update group',
        delete_group_failed: 'Failed to delete group',

        // ===== routes/preferences =====
        fetch_preferences_failed: 'Failed to fetch preferences',
        save_preferences_failed: 'Failed to save preferences',
        update_preferences_failed: 'Failed to update preferences',

        // ===== routes/digest =====
        fetch_digest_list_failed: 'Failed to fetch digest list',
        digest_not_found: 'Digest not found',
        fetch_digest_failed: 'Failed to fetch digest',
        generate_digest_failed: 'Failed to generate digest',
        delete_failed: 'Delete failed',
        preview_failed: 'Preview failed',

        // ===== routes/ai =====
        ai_not_configured_server: 'AI not configured on server',
        provide_api_url_and_key: 'Please provide complete API URL and Key',

        // ===== services/digest-service =====
        ai_not_configured: 'AI not configured, please configure AI API in settings',
        ai_api_error: 'AI API Error',
        all_subscriptions: 'All Subscriptions',
        today: 'Today',
        feed: 'Feed',
        group: 'Group',
        no_articles_in_hours: 'No {unread}articles in the past {hours} hours.',
        no_articles_today: 'No {unread}articles today.',
        unread: 'unread ',
        digest_word: 'Digest',

        // ===== utils/digest-store =====
        all: 'All',
    }
};

/**
 * 从请求中解析语言偏好
 * 优先使用 Accept-Language 头，回退到 zh
 */
export function getLang(req) {
    if (!req) return 'zh';
    const acceptLang = req.headers?.['accept-language'] || '';
    if (acceptLang.toLowerCase().startsWith('en')) return 'en';
    return 'zh';
}

/**
 * 翻译函数
 * @param {string} key - 翻译 key
 * @param {string} lang - 语言代码 ('zh' | 'en')
 * @param {object} params - 插值参数，如 { hours: 12 }
 * @returns {string}
 */
export function t(key, lang = 'zh', params = {}) {
    const dict = messages[lang] || messages.zh;
    let text = dict[key] || messages.zh[key] || key;

    // 简单模板插值: {hours}, {unread} 等
    if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
    }

    return text;
}
