// devolucoes-sync — puxa as devoluções das 5 lojas e grava em def_dev_retorno.
// Usa os proxies já existentes (shopee-proxy, tiktok-proxy, shein-proxy), que guardam as credenciais.
// Corpo opcional: { "dias": 45, "lojas": ["shopee:jingas", ...] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function proxy(nome: string, corpo: unknown): Promise<any> {
  const r = await fetch(`${URL_BASE}/functions/v1/${nome}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify(corpo),
  });
  return await r.json();
}

type Linha = {
  plataforma: string; loja: string; devolucao_id: string; n_pedido: string | null;
  rastreio: string | null; transportadora: string | null; status: string | null;
  motivo: string | null; criado_em: string | null; itens: any[]; atualizado_em: string;
};
const agora = () => new Date().toISOString();
const iso = (s: number) => new Date(s * 1000).toISOString();

/* ---------------- Shopee ---------------- */
async function shopee(loja: string, dias: number): Promise<Linha[]> {
  const fim = Math.floor(Date.now() / 1000);
  const ini = fim - dias * 86400;
  const devs: any[] = [];
  for (let to = fim; to > ini; to -= 14 * 86400) {
    const from = Math.max(ini, to - 14 * 86400);
    for (let page = 0; page < 20; page++) {
      const d = await proxy("shopee-proxy", {
        account: loja, action: "call", path: "/api/v2/returns/get_return_list",
        query: { page_no: page, page_size: 50, create_time_from: from, create_time_to: to },
      });
      const r = d?.resp?.response;
      if (!r) throw new Error(`shopee ${loja}: ${JSON.stringify(d?.resp ?? d).slice(0, 300)}`);
      devs.push(...(r.return ?? []));
      if (!r.more) break;
    }
  }
  // nome da variação: vem do detalhe do pedido (a devolução só traz model_id)
  const modelos = new Map<string, string>();
  const pedidos = [...new Set(devs.map((x) => x.order_sn))];
  for (let i = 0; i < pedidos.length; i += 50) {
    const d = await proxy("shopee-proxy", {
      account: loja, action: "order-detail", order_sn_list: pedidos.slice(i, i + 50), fields: "item_list",
    });
    for (const o of d?.resp?.response?.order_list ?? []) {
      for (const it of o.item_list ?? []) {
        modelos.set(`${o.order_sn}:${it.model_id}`, it.model_name || "");
        modelos.set(`sku:${o.order_sn}:${it.model_id}`, it.model_sku || it.item_sku || "");
      }
    }
  }
  return devs.map((x) => ({
    plataforma: "Shopee", loja, devolucao_id: x.return_sn, n_pedido: x.order_sn,
    rastreio: x.tracking_number || null, transportadora: x.tracking_number ? "SPX" : null,
    status: x.status, motivo: x.text_reason || x.reason || null, criado_em: iso(x.create_time),
    itens: (x.item ?? []).map((it: any) => ({
      produto: it.name,
      variacao: modelos.get(`${x.order_sn}:${it.model_id}`) || null,
      sku: modelos.get(`sku:${x.order_sn}:${it.model_id}`) || it.variation_sku || it.item_sku || null,
      quantidade: it.amount ?? 1, imagem: it.images?.[0] ?? null,
    })),
    atualizado_em: agora(),
  }));
}

/* ---------------- TikTok ---------------- */
async function tiktok(loja: string, dias: number): Promise<Linha[]> {
  const fim = Math.floor(Date.now() / 1000);
  const out: Linha[] = [];
  let token = "";
  for (let g = 0; g < 40; g++) {
    const query: Record<string, any> = { page_size: 50 };
    if (token) query.page_token = token;
    const d = await proxy("tiktok-proxy", {
      account: loja, action: "call", method: "POST", path: "/return_refund/202309/returns/search",
      query, body: { create_time_ge: fim - dias * 86400, create_time_lt: fim },
    });
    if (d?.resp?.code !== 0) throw new Error(`tiktok ${loja}: ${JSON.stringify(d?.resp ?? d).slice(0, 300)}`);
    const data = d.resp.data ?? {};
    for (const x of data.return_orders ?? []) {
      // cada linha é uma unidade: agrupa produto + variação
      const grupos = new Map<string, any>();
      for (const li of x.return_line_items ?? []) {
        const k = `${li.product_name}|${li.sku_name}`;
        const g0 = grupos.get(k) ?? {
          produto: li.product_name, variacao: li.sku_name || null, sku: li.seller_sku || null,
          quantidade: 0, imagem: li.product_image?.url ?? null,
        };
        g0.quantidade += 1;
        grupos.set(k, g0);
      }
      out.push({
        plataforma: "TikTok Shop", loja, devolucao_id: x.return_id, n_pedido: x.order_id,
        rastreio: x.return_tracking_number || null, transportadora: x.return_provider_name || null,
        status: x.return_status, motivo: x.return_reason_text || x.return_reason || null,
        criado_em: iso(x.create_time), itens: [...grupos.values()], atualizado_em: agora(),
      });
    }
    token = data.next_page_token || "";
    if (!token) break;
  }
  return out;
}

/* ---------------- SHEIN ---------------- */
function fmt(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
/* A SHEIN é chamada direto (e não pelo shein-proxy): são ~30 chamadas e o Supabase
   limita chamadas encadeadas entre funções. Assinatura igual à do shein-proxy. */
function hexb(buf: ArrayBuffer) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function rndKey(n = 5) { const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; let r = ""; const b = new Uint8Array(n); crypto.getRandomValues(b); for (let i = 0; i < n; i++) r += c[b[i] % c.length]; return r; }
async function sheinSign(keyId: string, secret: string, path: string, ts: string) {
  const rk = rndKey(5); const e = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", e.encode(`${secret}${rk}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return rk + btoa(hexb(await crypto.subtle.sign("HMAC", k, e.encode(`${keyId}&${ts}&${path}`))));
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function sheinCliente(db: any) {
  let client: any = null; let cred: any = null;
  return {
    async iniciar() {
      const { data: c } = await db.from("shein_credentials").select("open_key_id, secret_key").order("id", { ascending: false }).limit(1).maybeSingle();
      cred = c;
      const { data: pc } = await db.from("proxy_config").select("proxy_url").order("id", { ascending: false }).limit(1).maybeSingle();
      if (pc?.proxy_url) client = (Deno as any).createHttpClient({ proxy: { url: pc.proxy_url } });
    },
    async call(path: string, body: unknown): Promise<any> {
      for (let tent = 0; tent < 4; tent++) {
        const ts = Date.now().toString();
        const sig = await sheinSign(cred.open_key_id, cred.secret_key, path, ts);
        const opts: any = { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "x-lt-openKeyId": cred.open_key_id, "x-lt-timestamp": ts, "x-lt-signature": sig, language: "en" }, body: JSON.stringify(body) };
        if (client) opts.client = client;
        const r = await fetch(`https://openapi.sheincorp.com${path}`, opts);
        const t = await r.text(); let b: any; try { b = JSON.parse(t); } catch { b = { code: "http" + r.status, msg: t.slice(0, 200) }; }
        if (b?.code === "0") { await dormir(150); return b; }
        if (/limit/i.test(String(b?.msg ?? ""))) { await dormir(1500 * (tent + 1)); continue; }
        throw new Error(`shein ${path}: ${JSON.stringify(b).slice(0, 300)}`);
      }
      throw new Error(`shein ${path}: limite de chamadas`);
    },
    fechar() { try { client?.close?.(); } catch (_) { /* */ } },
  };
}

async function shein(dias: number, db: any): Promise<Linha[]> {
  const api = sheinCliente(db);
  await api.iniciar();
  try {
  // a lista aceita no máximo 48h por consulta e 30 por página; o horário é o da China (UTC+8)
  const nos = new Set<string>();
  const fim = Date.now() + 8 * 3600e3 + 3600e3;
  const ini = fim - dias * 86400e3;
  for (let e = fim; e > ini; e -= 47 * 3600e3) {
    const s = Math.max(ini, e - 47 * 3600e3);
    for (let page = 1; page < 20; page++) {
      const d = await api.call("/open-api/return-order/list",
        { page, pageSize: 30, queryType: 1, startTime: fmt(new Date(s)), endTime: fmt(new Date(e)) });
      const lst = d.info?.returnOrderList ?? [];
      for (const r of lst) nos.add(r.returnOrderNo);
      if (lst.length < 30) break;
    }
  }
  const lista = [...nos];
  const out: Linha[] = [];
  for (let i = 0; i < lista.length; i += 10) {
    const d = await api.call("/open-api/return-order/details", { returnOrderNoList: lista.slice(i, i + 10) });
    for (const x of d.info ?? []) {
      const grupos = new Map<string, any>();
      let motivo: string | null = null;
      for (const g of x.returnGoodsInfoList ?? []) {
        const pt = (g.commodityAttributeList ?? []).find((a: any) => a.language === "PT")?.attrName;
        const k = `${g.goodsTitle}|${pt}`;
        const g0 = grupos.get(k) ?? {
          produto: g.goodsTitle, variacao: pt || null, sku: g.goodsSn || null, quantidade: 0,
          imagem: g.imageUrl ?? null,
        };
        g0.quantidade += 1;
        grupos.set(k, g0);
        motivo ??= (g.returnReasonList ?? []).find((r: any) => r.language === "PT")?.reason ?? null;
      }
      const t = x.requestReturnTime ? new Date(x.requestReturnTime.replace(" ", "T") + "+08:00").toISOString() : null;
      out.push({
        plataforma: "SHEIN", loja: "bilhan", devolucao_id: x.returnOrderNo, n_pedido: x.orderNo,
        rastreio: x.platformExpressNo || x.memberExpressNo || x.refundWaybill || null,
        transportadora: x.expressCompanyName || null, status: String(x.returnOrderStatus ?? ""),
        motivo, criado_em: t, itens: [...grupos.values()], atualizado_em: agora(),
      });
    }
  }
  return out;
  } finally { api.fechar(); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let p: any = {};
  try { p = await req.json(); } catch (_) { /* */ }
  const dias = Math.min(Number(p.dias) || 45, 90);
  const lojas: string[] = p.lojas ?? ["shopee:jingas", "shopee:bilhan", "tiktok:bubli", "tiktok:bilhan", "shein:bilhan"];
  const db = createClient(URL_BASE, SERVICE);

  const resultado: Record<string, any> = {};
  await Promise.all(lojas.map(async (l) => {
    const [plat, loja] = l.split(":");
    try {
      const linhas = plat === "shopee" ? await shopee(loja, dias)
        : plat === "tiktok" ? await tiktok(loja, dias)
        : await shein(dias, db);
      for (let i = 0; i < linhas.length; i += 200) {
        const { error } = await db.from("def_dev_retorno")
          .upsert(linhas.slice(i, i + 200), { onConflict: "plataforma,loja,devolucao_id" });
        if (error) throw error;
      }
      resultado[l] = { ok: true, devolucoes: linhas.length };
    } catch (e) {
      resultado[l] = { ok: false, erro: String((e as any)?.message ?? e) };
    }
  }));
  await db.from("configuracao").upsert(
    { chave: "devolucoes.ultima_sync", valor: agora(), obs: "Última sincronização das devoluções (devolucoes-sync)", atualizado_em: agora() },
    { onConflict: "chave" },
  );
  return json({ ok: Object.values(resultado).every((r: any) => r.ok), dias, resultado });
});
