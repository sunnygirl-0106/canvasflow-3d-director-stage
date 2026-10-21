// 本地 Vite 服务代理：凭据只从服务端环境读取，不进入浏览器或构建产物。
export function localAiPlugin(env) {
  const enabled = !!(env.AI_API_KEY && env.AI_BASE_URL && env.AI_MODEL);
  const install = (server) => {
    // configureServer 不能返回 middlewares.use() 的结果：Vite 会把返回函数当作后置 hook 调用。
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] !== '/api/local-ai/chat/completions') return next();
      const reply = (status, message) => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message } }));
      };
      if (!enabled) return reply(503, '本机模型接口尚未配置');
      if (req.method !== 'POST') return reply(405, '仅支持 POST');
      try {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, '不允许跨站请求');
      } catch { return reply(403, '无效请求来源'); }
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(415, '仅支持 JSON');
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', cancel);
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) return reply(413, '请求过大');
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reply(400, 'JSON 格式错误'); }
        if (!input || !Array.isArray(input.messages) || !input.messages.length) return reply(400, 'messages 必须是非空数组');
        const upstream = await fetch(`${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
          body: JSON.stringify({ model: env.AI_MODEL, messages: input.messages, temperature: input.temperature, response_format: input.response_format, stream: false }),
          signal: controller.signal,
        });
        const text = (await upstream.text()).split(env.AI_API_KEY).join('[redacted]');
        if (res.destroyed) return;
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(text);
      } catch {
        reply(502, '模型接口连接失败或超时');
      } finally {
        clearTimeout(timer);
        res.off('close', cancel);
      }
    });
  };
  return { name: 'local-ai', configureServer: install, configurePreviewServer: install };
}
