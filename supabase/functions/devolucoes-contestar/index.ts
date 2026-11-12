// devolucoes-contestar — contesta uma devolução na loja, com fotos.
//   Shopee: abre disputa (returns/dispute + upload_proof)
//   TikTok: rejeita a devolução (returns/{id}/reject)
//   SHEIN: sem API de contestação — pela Central do Vendedor
// Só o perfil admin do app de defeitos pode chamar.
// Ações: { acao: "opcoes", devolucao_id }  |  { acao: "enviar", devolucao_id, motivo, comentario, email?, fotos: [path] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "devolucoes";

/* ------------------------------------------------------------------ util */
function hexb(buf: ArrayBuffer) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function hmacHex(key: string, msg: string) {
  const e = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", e.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexb(await crypto.subtle.sign("HMAC", k, e.encode(msg)));
}
function qs(o: Record<string, any>) {
  return Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}
async function lerResp(r: Response) { const t = await r.text(); try { return JSON.parse(t); } catch { return { erro_http: r.status, texto: t.slice(0, 300) }; } }

/* Motivos de disputa da Shopee: a API só devolve o número. Nomes pela exigência de prova de cada um. */
const MOTIVOS_SHOPEE: Record<number, string> = {
  46: "Não recebi o produto devolvido",
  47: "Produto devolvido danificado",
  48: "Pacote vazio ou faltando itens",
  49: "Produto devolvido diferente do enviado (outra peça)",
  50: "Outro motivo",
  56: "Produto devolvido com sinais de uso",
};

/* ------------------------------------------------------------------ Shopee */
async function shopeeCliente(db: any, loja: string) {
  const { data: cred } = await db.from("shopee_credentials").select("*").eq("label", loja).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error(`sem credencial Shopee ${loja}`);
  const { data: pc } = await db.from("proxy_config").select("proxy_url").order("id", { ascending: false }).limit(1).maybeSingle();
  const client = pc?.proxy_url ? (Deno as any).createHttpClient({ proxy: { url: pc.proxy_url } }) : null;
  const host = "https://partner.shopeemobile.com";
  const assinar = async (path: string) => {
    const ts = Math.floor(Date.now() / 1000);
    const sign = await hmacHex(cred.partner_key, `${cred.partner_id}${path}${ts}${cred.access_token}${cred.shop_id}`);
    return `${host}${path}?${qs({ partner_id: cred.partner_id, timestamp: ts, access_token: cred.access_token, shop_id: cred.shop_id, sign })}`;
  };
  const ir = async (url: string, opts: any) => lerResp(await fetch(url, client ? { ...opts, client } : opts));
  return {
    get: async (path: string, q: Record<string, any>) => ir(`${await assinar(path)}&${qs(q)}`, { method: "GET" }),
    post: async (path: string, body: unknown) =>
      ir(await assinar(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    multipart: async (path: string, fd: FormData) => ir(await assinar(path), { method: "POST", body: fd }),
    fechar: () => { try { client?.close?.(); } catch (_) { /* */ } },
  };
}

/* Sobe uma imagem para a Shopee e devolve a URL que a disputa aceita. */
async function shopeeImagem(sp: any, bytes: Uint8Array, nome: string) {
  let ultimo: any = null;
  for (const campo of ["upload_image", "image", "file"]) {
    const fd = new FormData();
    fd.append(campo, new Blob([bytes], { type: "image/jpeg" }), nome);
    const r = await sp.multipart("/api/v2/returns/convert_image", fd);
    const url = r?.response?.url ?? r?.response?.image_url ?? r?.response?.thumbnail ?? null;
    if (url) return { url, thumbnail: r?.response?.thumbnail ?? url };
    ultimo = r;
    if (!/no such file|missing|upload/i.test(String(r?.message ?? ""))) break;
  }
  throw new Error(`Shopee não aceitou a foto: ${JSON.stringify(ultimo).slice(0, 200)}`);
}

/* ------------------------------------------------------------------ TikTok */
async function tiktokCliente(db: any, loja: string) {
  const { data: cred } = await db.from("tiktok_credentials").select("*").eq("label", loja).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error(`sem credencial TikTok ${loja}`);
  const host = "https://open-api.tiktokglobalshop.com";
  const assinar = async (path: string, query: Record<string, any>, corpo: string, metodo: string) => {
    const keys = Object.keys(query).filter((k) => k !== "sign" && k !== "access_token").sort();
    let s = path; for (const k of keys) s += `${k}${query[k]}`;
    if (metodo !== "GET" && corpo) s += corpo;
    return await hmacHex(cred.app_secret, cred.app_secret + s + cred.app_secret);
  };
  const chamar = async (metodo: string, path: string, q: Record<string, any> = {}, body?: unknown) => {
    const query: Record<string, any> = { app_key: cred.app_key, timestamp: Math.floor(Date.now() / 1000), shop_cipher: cred.shop_cipher, ...q };
    const corpo = body !== undefined ? JSON.stringify(body) : "";
    query.sign = await assinar(path, query, corpo, metodo);
    return lerResp(await fetch(`${host}${path}?${qs(query)}`, {
      method: metodo, headers: { "content-type": "application/json", "x-tts-access-token": cred.access_token },
      body: metodo === "GET" ? undefined : corpo,
    }));
  };
  const imagem = async (bytes: Uint8Array, nome: string) => {
    const path = "/product/202309/images/upload";
    const query: Record<string, any> = { app_key: cred.app_key, timestamp: Math.floor(Date.now() / 1000) };
    query.sign = await assinar(path, query, "", "POST");
    const fd = new FormData();
    fd.append("data", new Blob([bytes], { type: "image/jpeg" }), nome);
    fd.append("use_case", "MAIN_IMAGE");
    const r = await lerResp(await fetch(`${host}${path}?${qs(query)}`, { method: "POST", headers: { "x-tts-access-token": cred.access_token }, body: fd }));
    if (r?.code !== 0) throw new Error(`TikTok não aceitou a foto: ${JSON.stringify(r).slice(0, 200)}`);
    return { image_id: r.data.uri, mime_type: "image/jpeg", width: r.data.width, height: r.data.height };
  };
  return { chamar, imagem };
}

/* ------------------------------------------------------------------ handler */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(SB_URL, SERVICE);
  try {
    const p = await req.json();

    // quem chamou? só admin. Exceção: diagnóstico só-leitura com o token de teste da configuração
    // (chave devolucoes.token_teste; vazio = desligado), nunca para "enviar".
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    const email = u?.user?.email;
    const { data: perfil } = email ? await db.from("def_perfil").select("papel").eq("email", email).maybeSingle() : { data: null };
    let admin = perfil?.papel === "admin";
    if (!admin && p.acao !== "enviar" && req.headers.get("x-teste")) {
      const { data: t } = await db.from("configuracao").select("valor").eq("chave", "devolucoes.token_teste").maybeSingle();
      admin = !!t?.valor && t.valor === req.headers.get("x-teste");
    }
    if (!admin) return json({ ok: false, erro: "Só a Ana pode contestar devoluções." }, 403);

    // diagnóstico: testa o envio de uma imagem de exemplo para a Shopee/TikTok (não contesta nada)
    if (p.acao === "teste_imagem") {
      const png = Uint8Array.from(atob(p.imagem_b64), (c) => c.charCodeAt(0));
      if (p.plataforma === "Shopee") {
        const sp = await shopeeCliente(db, p.loja);
        try { return json({ ok: true, r: await shopeeImagem(sp, png, "teste.jpg") }); } finally { sp.fechar(); }
      }
      const tk = await tiktokCliente(db, p.loja);
      return json({ ok: true, r: await tk.imagem(png, "teste.jpg") });
    }
    const { data: dev } = await db.from("def_devolucoes")
      .select("*, retorno:def_dev_retorno(*), itens:def_devolucao_itens(*), fotos:def_devolucao_fotos(*)")
      .eq("id", p.devolucao_id).maybeSingle();
    if (!dev) return json({ ok: false, erro: "Devolução não encontrada." }, 404);
    const ret = dev.retorno;
    if (!ret) return json({ ok: false, erro: "Esta devolução não está ligada a um pedido de devolução da loja." });

    /* ---------- opções: status ao vivo, prazo e motivos ---------- */
    if (p.acao === "opcoes") {
      if (ret.plataforma === "Shopee") {
        const sp = await shopeeCliente(db, ret.loja);
        try {
          const det = await sp.get("/api/v2/returns/get_return_detail", { return_sn: ret.devolucao_id });
          const mot = await sp.get("/api/v2/returns/get_return_dispute_reason", { return_sn: ret.devolucao_id });
          const d = det?.response ?? {};
          const motivos = (mot?.response?.dispute_reason_list ?? []).map((m: any) => ({
            codigo: String(m.dispute_reason),
            texto: MOTIVOS_SHOPEE[m.dispute_reason] ?? `Motivo ${m.dispute_reason}`,
            exige: (m.evidence_module_list ?? []).map((x: any) => x.requirement).join(" · ") || null,
          }));
          return json({
            ok: true, plataforma: "Shopee", status: d.status, prazo: d.return_seller_due_date ? new Date(d.return_seller_due_date * 1000).toISOString() : null,
            pode: motivos.length > 0, aviso: motivos.length ? null : (mot?.message || "A Shopee não permite disputa nesta etapa."),
            precisa_email: true, motivos, motivo_cliente: d.text_reason ?? ret.motivo, fotos_cliente: d.image ?? [],
          });
        } finally { sp.fechar(); }
      }
      if (ret.plataforma === "TikTok Shop") {
        const tk = await tiktokCliente(db, ret.loja);
        const r = await tk.chamar("GET", "/return_refund/202309/reject_reasons", { return_or_cancel_id: ret.devolucao_id, locale: "pt-BR" });
        const lista = r?.data?.reasons ?? r?.data?.reject_reasons ?? [];
        const motivos = lista.map((m: any) => ({
          codigo: m.name ?? m.reason ?? m.reason_name ?? m.id,
          texto: m.text ?? m.reason_text ?? m.description ?? m.name,
          exige: m.evidence_tips ?? m.tips ?? null,
        }));
        return json({
          ok: true, plataforma: "TikTok Shop", status: ret.status, prazo: null, pode: r?.code === 0 && motivos.length > 0,
          aviso: r?.code === 0 ? (motivos.length ? null : "O TikTok não oferece motivo de rejeição nesta etapa.") : (r?.message ?? "O TikTok não permite rejeitar nesta etapa."),
          precisa_email: false, motivos, motivo_cliente: ret.motivo, fotos_cliente: [],
        });
      }
      return json({ ok: true, plataforma: ret.plataforma, pode: false, aviso: "A SHEIN não tem contestação pela API. Conteste pela Central do Vendedor.", motivos: [] });
    }

    /* ---------- enviar ---------- */
    if (p.acao === "enviar") {
      if (!p.motivo) return json({ ok: false, erro: "Escolha o motivo." });
      const paths: string[] = p.fotos ?? [];
      const fotos: { bytes: Uint8Array; nome: string }[] = [];
      for (const path of paths.slice(0, 9)) {
        const { data, error } = await db.storage.from(BUCKET).download(path);
        if (error) throw new Error(`foto ${path}: ${error.message}`);
        fotos.push({ bytes: new Uint8Array(await data.arrayBuffer()), nome: path.split("/").pop() ?? "foto.jpg" });
      }
      let resultado: any = null; let ok = false;

      if (ret.plataforma === "Shopee") {
        if (!p.email) return json({ ok: false, erro: "A Shopee exige um e-mail para a disputa." });
        const sp = await shopeeCliente(db, ret.loja);
        try {
          const imgs = [];
          for (const f of fotos) imgs.push(await shopeeImagem(sp, f.bytes, f.nome));
          const disputa = await sp.post("/api/v2/returns/dispute", {
            return_sn: ret.devolucao_id, email: p.email, dispute_reason: Number(p.motivo),
            dispute_text_reason: p.comentario ?? "", images: imgs.map((i) => i.url),
          });
          ok = !disputa?.error;
          let prova: any = null;
          if (ok && imgs.length) {
            prova = await sp.post("/api/v2/returns/upload_proof", {
              return_sn: ret.devolucao_id, photo: imgs.map((i) => ({ thumbnail: i.thumbnail, url: i.url })),
              description: p.comentario ?? "",
            });
          }
          resultado = { disputa, prova };
        } finally { sp.fechar(); }
      } else if (ret.plataforma === "TikTok Shop") {
        const tk = await tiktokCliente(db, ret.loja);
        const images = [];
        for (const f of fotos) images.push(await tk.imagem(f.bytes, f.nome));
        const tentativas: any[] = [];
        // a decisão depende da etapa: pacote já recebido → rejeita o pacote; antes disso → rejeita o pedido
        for (const decision of ["REJECT_RECEIVED_PACKAGE", "REJECT_RETURN", "REJECT_REFUND"]) {
          const r = await tk.chamar("POST", `/return_refund/202309/returns/${ret.devolucao_id}/reject`,
            { idempotency_key: crypto.randomUUID() },
            { decision, reject_reason: p.motivo, comment: p.comentario ?? "", images });
          tentativas.push({ decision, code: r?.code, message: r?.message });
          if (r?.code === 0) { ok = true; break; }
          if (!/decision/i.test(String(r?.message ?? ""))) break; // erro que não é da decisão: para
        }
        resultado = { tentativas };
      } else {
        return json({ ok: false, erro: "A SHEIN não tem contestação pela API." });
      }

      await db.from("def_dev_contestacao").insert({
        devolucao_id: dev.id, plataforma: ret.plataforma, motivo_codigo: String(p.motivo), motivo_texto: p.motivo_texto ?? null,
        comentario: p.comentario ?? null, fotos: paths, ok, resposta: resultado, criado_por: email,
      });
      const msg = ok ? null
        : resultado?.disputa?.message ?? resultado?.tentativas?.at(-1)?.message ?? "A loja recusou a contestação.";
      return json({ ok, erro: msg, resultado });
    }
    return json({ ok: false, erro: "ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, erro: String((e as any)?.message ?? e) }, 500);
  }
});
