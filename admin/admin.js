/* =====================================================================
   PAINEL DA LETÍCIA
   Cada aba lê e grava no Supabase. Se uma tabela faltar, aparece um
   aviso no topo e o resto do painel continua funcionando.
   ===================================================================== */
(async function () {
  "use strict";

  const banco = window.banco;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* textos da biblioteca têm negrito e itálico: deixa passar só essas marcações */
  const htmlSeguro = (t) => esc(t).replace(/&lt;(\/?)(b|strong|em|i|br)&gt;/g, "<$1$2>");

  /* ---------------------------------------------------------------
     0) CONFERE A SESSÃO ANTES DE MOSTRAR QUALQUER COISA
     --------------------------------------------------------------- */
  if (!banco) {
    document.body.classList.remove("esperando");
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Não consegui carregar o painel. Confira a sua internet e recarregue a página.</p>';
    return;
  }
  let sessao = null;
  try {
    const { data } = await banco.auth.getSession();
    sessao = data && data.session;
  } catch (erro) { sessao = null; }
  if (!sessao) { location.replace("../login/"); return; }
  banco.auth.onAuthStateChange((evento, s) => { if (evento === "SIGNED_OUT" || (!s && evento !== "INITIAL_SESSION")) location.replace("../login/"); });
  document.body.classList.remove("esperando");
  $("#usuario-email").textContent = sessao.user.email || "";

  /* ---------------------------------------------------------------
     1) AJUDANTES (datas, números, avisos)
     --------------------------------------------------------------- */
  const dois = (n) => String(n).padStart(2, "0");
  const isoLocal = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  const deISO = (s) => {
    if (!s) return null;
    const [a, m, d] = String(s).slice(0, 10).split("-").map(Number);
    return a && m && d ? new Date(a, m - 1, d) : null;
  };
  const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const diasAte = (s) => { const d = deISO(s); return d ? Math.round((d - hoje0()) / 86400000) : null; };
  const dataBR = (s) => { const d = deISO(s); return d ? `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}` : ""; };
  const numero = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
  const moeda = (n) => numero(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const idYT = (link) => (String(link || "").match(/(?:shorts\/|[?&]v=|youtu\.be\/|embed\/)([\w-]{11})/) || [])[1] || "";

  const avisosMostrados = new Set();
  function avisar(chave, texto) {
    if (avisosMostrados.has(chave)) return;
    avisosMostrados.add(chave);
    const div = document.createElement("div");
    div.className = "aviso";
    div.textContent = texto;
    /* quando falta tabela ou campo, dá para copiar o SQL completo com um clique */
    if (/banco\.sql/.test(texto)) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "botao botao-leve aviso-botao";
      botao.textContent = "Copiar o SQL";
      botao.addEventListener("click", copiarSQL);
      div.appendChild(botao);
      const passos = document.createElement("small");
      passos.textContent = "Depois cole no Supabase: SQL Editor, New query, cole e clique em Run. Pode rodar quantas vezes quiser, não apaga nada.";
      div.appendChild(passos);
    }
    $("#avisos").appendChild(div);
  }
  async function copiarSQL() {
    try {
      const resposta = await fetch("atualizar.sql", { cache: "no-store" });
      if (!resposta.ok) throw new Error("sem arquivo");
      const sql = await resposta.text();
      await navigator.clipboard.writeText(sql);
      recado("SQL copiado. Agora cole no SQL Editor do Supabase e clique em Run.");
    } catch (erro) {
      recado("Não consegui copiar sozinha. Abra o arquivo banco.sql da pasta do portfólio e copie de lá.", true);
    }
  }
  let recadoTempo = null;
  function recado(texto, erro) {
    const r = $("#recado");
    r.textContent = texto;
    r.className = "recado" + (erro ? " erro" : "");
    r.hidden = false;
    clearTimeout(recadoTempo);
    recadoTempo = setTimeout(() => { r.hidden = true; }, 3400);
  }
  function traduzErro(erro, tabela) {
    const codigo = (erro && erro.code) || "";
    const msg = String((erro && (erro.message || erro.details)) || "").toLowerCase();
    if (codigo === "42P01" || codigo === "PGRST205" || msg.includes("could not find the table") || (msg.includes("relation") && msg.includes("does not exist")))
      return `Não encontrei a tabela "${tabela}" no banco. Rode o arquivo banco.sql no Supabase (SQL Editor) e recarregue esta página. O resto do painel continua funcionando.`;
    if (codigo === "42703" || codigo === "PGRST204" || msg.includes("column"))
      return `A tabela "${tabela}" está sem algum campo que o painel usa. Rode o banco.sql de novo no Supabase. O resto do painel continua funcionando.`;
    if (codigo === "42501" || msg.includes("permission") || msg.includes("row-level security"))
      return `Sem permissão para usar a tabela "${tabela}". Confira se você entrou com um dos e-mails liberados no banco.sql e se ele foi rodado.`;
    if (codigo === "23514") return "Algum campo está com um valor que o banco não aceita.";
    if (codigo === "23502") return "Faltou preencher um campo obrigatório.";
    if (msg.includes("fetch") || msg.includes("network")) return "Sem conexão com o banco agora. Confira a sua internet e tente de novo.";
    return `Não deu certo com "${tabela}" agora. Tente de novo em instantes.`;
  }

  /* ---------------------------------------------------------------
     2) DADOS: carrega tudo uma vez e guarda aqui
     --------------------------------------------------------------- */
  const ESPERADOS = {
    videos: ["titulo", "link", "nicho", "formato", "marca", "destaque", "ordem", "visivel"],
    marcas: ["nome", "instagram", "email", "telefone", "situacao", "obs", "ultimo_contato"],
    calendario: ["titulo", "marca", "tipo", "data", "status"],
    campanhas: ["campanha", "cliente", "tipo", "status", "qtd", "valor", "prazo", "pagamento", "ativa", "favorita"],
    marcados: ["chave", "marcado"],
    visitas: ["data", "pagina", "origem"],
    eventos: ["data", "tipo", "alvo", "detalhe", "origem", "dispositivo"],
    roteiros: ["fonte", "url", "perfil", "de_quem", "titulo", "transcricao", "legenda", "postado_em", "tags", "obs", "status", "erro"],
    configuracoes: ["chave", "valor"],
    virais: ["url", "fonte", "perfil", "titulo", "nicho", "transcricao", "analise", "adaptacoes", "status"],
    tendencias: ["nichos", "plataformas", "resumo", "itens", "fontes", "sem_busca"]
  };
  const dados = { videos: [], marcas: [], calendario: [], campanhas: [], visitas: [], eventos: [], roteiros: [], virais: [], tendencias: [], config: {} };
  const marcados = new Set();

  async function buscar(tabela, montar) {
    try {
      const { data, error } = await montar(banco.from(tabela));
      if (error) throw error;
      const linhas = data || [];
      if (linhas.length) {
        const falta = ESPERADOS[tabela].filter((c) => !(c in linhas[0]));
        if (falta.length) avisar("campo-" + tabela, `A tabela "${tabela}" está sem ${falta.length === 1 ? "o campo" : "os campos"} ${falta.join(", ")}. Rode o banco.sql de novo no Supabase. O resto continua funcionando.`);
      }
      return linhas;
    } catch (erro) {
      avisar("tabela-" + tabela, traduzErro(erro, tabela));
      return [];
    }
  }

  /* o Supabase entrega no máximo 1000 linhas por vez: aqui busca de 1000 em 1000 (até 30 dias) */
  async function buscarEmPartes(tabela, desde) {
    const tudo = [];
    for (let pagina = 0; pagina < 50; pagina++) {
      const parte = await buscar(tabela, (q) => q.select("*").gte("data", desde.toISOString()).order("data", { ascending: false }).range(pagina * 1000, pagina * 1000 + 999));
      tudo.push(...parte);
      if (parte.length < 1000) break;
    }
    return tudo;
  }

  async function carregarTudo() {
    const desde = hoje0(); desde.setDate(desde.getDate() - 29);
    const [v, m, c, cp, mc, vi, ev, rt, cf, vr, td] = await Promise.all([
      buscar("videos", (q) => q.select("*").order("ordem", { ascending: true }).order("id", { ascending: true })),
      buscar("marcas", (q) => q.select("*").order("id", { ascending: false })),
      buscar("calendario", (q) => q.select("*").order("data", { ascending: true })),
      buscar("campanhas", (q) => q.select("*").order("id", { ascending: false })),
      buscar("marcados", (q) => q.select("*")),
      buscarEmPartes("visitas", desde),
      buscarEmPartes("eventos", desde),
      buscar("roteiros", (q) => q.select("*").order("created_at", { ascending: false }).limit(1000)),
      buscar("configuracoes", (q) => q.select("*")),
      buscar("virais", (q) => q.select("*").order("created_at", { ascending: false }).limit(1000)),
      buscar("tendencias", (q) => q.select("*").order("created_at", { ascending: false }).limit(60))
    ]);
    dados.videos = v; dados.marcas = m; dados.calendario = c; dados.campanhas = cp; dados.visitas = vi; dados.eventos = ev; dados.roteiros = rt; dados.virais = vr; dados.tendencias = td;
    dados.config = {};
    cf.forEach((linha) => { if (linha.chave) dados.config[linha.chave] = linha.valor || ""; });
    marcados.clear();
    mc.forEach((linha) => { if (linha.marcado !== false && linha.chave) marcados.add(linha.chave); });
  }

  async function gravar(tabela, valores, id) {
    try {
      const consulta = id
        ? banco.from(tabela).update(valores).eq("id", id).select().single()
        : banco.from(tabela).insert(valores).select().single();
      const { data, error } = await consulta;
      if (error) throw error;
      return data;
    } catch (erro) {
      recado(traduzErro(erro, tabela), true);
      return null;
    }
  }
  async function apagar(tabela, id) {
    try {
      const { error } = await banco.from(tabela).delete().eq("id", id);
      if (error) throw error;
      return true;
    } catch (erro) {
      recado(traduzErro(erro, tabela), true);
      return false;
    }
  }
  function trocarNaLista(lista, linha) {
    const i = lista.findIndex((x) => x.id === linha.id);
    if (i >= 0) lista[i] = linha; else lista.push(linha);
  }

  function baixarCSV(nomeArquivo, cabecalho, linhas) {
    const celula = (v) => { const s = String(v == null ? "" : v); return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const texto = "﻿" + [cabecalho].concat(linhas).map((l) => l.map(celula).join(";")).join("\r\n");
    const blob = new Blob([texto], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------------------------------------------------------
     3) JANELA E FORMULÁRIO (usados por todas as abas)
     --------------------------------------------------------------- */
  function abrirModal(titulo, html, larga) {
    $("#modal-titulo").textContent = titulo;
    $("#modal-corpo").innerHTML = html;
    $(".modal").classList.toggle("larga", !!larga);
    $("#modal").hidden = false;
    const primeiro = $("#modal-corpo input:not([type=checkbox]), #modal-corpo select, #modal-corpo textarea");
    if (primeiro) primeiro.focus();
  }
  function fecharModal() { $("#modal").hidden = true; $("#modal-corpo").innerHTML = ""; }
  $("#modal-fechar").addEventListener("click", fecharModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) fecharModal(); });

  function campoHTML(campo, valores) {
    const v = valores[campo.nome];
    const classe = campo.inteira ? "inteira" : "";
    const dica = campo.dica ? `<small>${esc(campo.dica)}</small>` : "";
    if (campo.tipo === "checkbox")
      return `<label class="marcar inteira"><input type="checkbox" name="${campo.nome}" ${v ? "checked" : ""}> ${esc(campo.rotulo)}</label>`;
    if (campo.tipo === "select")
      return `<label class="${classe}">${esc(campo.rotulo)}<select name="${campo.nome}">${campo.opcoes.map(([valor, texto]) => `<option value="${esc(valor)}" ${String(v) === String(valor) ? "selected" : ""}>${esc(texto)}</option>`).join("")}</select>${dica}</label>`;
    if (campo.tipo === "textarea")
      return `<label class="inteira">${esc(campo.rotulo)}<textarea name="${campo.nome}" class="${campo.alto ? "alto" : ""}">${esc(v)}</textarea>${dica}</label>`;
    const lista = campo.lista ? `list="lista-${campo.nome}"` : "";
    const datalist = campo.lista ? `<datalist id="lista-${campo.nome}">${campo.lista.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
    const extra = campo.tipo === "number" ? `min="0" step="${campo.passo || 1}"` : "";
    return `<label class="${classe}">${esc(campo.rotulo)}${campo.obrigatorio ? " *" : ""}<input type="${campo.tipo || "text"}" name="${campo.nome}" value="${esc(v == null ? "" : v)}" ${lista} ${extra}>${datalist}${dica}</label>`;
  }

  function formulario({ titulo, campos, valores = {}, aoSalvar, aoApagar, larga, aviso }) {
    const html = `<form class="form-grade" id="form-modal" novalidate>
      ${aviso ? `<div class="form-aviso inteira">${esc(aviso)}</div>` : ""}
      ${campos.map((c) => campoHTML(c, valores)).join("")}
      <div class="form-acoes inteira">
        ${aoApagar ? '<button type="button" class="botao botao-perigo" id="form-apagar">Apagar</button>' : ""}
        <span class="espaco"></span>
        <button type="button" class="botao botao-leve" id="form-cancelar">Cancelar</button>
        <button type="submit" class="botao botao-principal" id="form-salvar">Salvar</button>
      </div></form>`;
    abrirModal(titulo, html, larga);
    const form = $("#form-modal");
    $("#form-cancelar").addEventListener("click", fecharModal);
    if (aoApagar) $("#form-apagar").addEventListener("click", async () => {
      if (!confirm("Apagar de vez? Isso não tem volta.")) return;
      if (await aoApagar()) fecharModal();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const obj = {};
      for (const c of campos) {
        const el = form.elements[c.nome];
        if (!el) continue;
        if (c.tipo === "checkbox") obj[c.nome] = el.checked;
        else if (c.tipo === "number") obj[c.nome] = el.value === "" ? 0 : numero(el.value.replace(",", "."));
        else if (c.tipo === "date") obj[c.nome] = el.value || null;
        else obj[c.nome] = el.value.trim();
        if (c.obrigatorio && (obj[c.nome] === "" || obj[c.nome] == null)) { recado(`Preencha: ${c.rotulo}`, true); el.focus(); return; }
      }
      const botao = $("#form-salvar");
      botao.disabled = true;
      const deuCerto = await aoSalvar(obj);
      if (deuCerto) fecharModal(); else botao.disabled = false;
    });
  }

  /* ---------------------------------------------------------------
     4) MENU E ABAS
     --------------------------------------------------------------- */
  const ABAS = {
    portfolio: ["Portfólio", renderPortfolio],
    marcas: ["Marcas", renderMarcas],
    calendario: ["Calendário", renderCalendario],
    campanhas: ["Campanhas", renderCampanhas],
    roteiros: ["📜 Roteiros", renderRoteiros],
    virais: ["🔥 Virais", renderVirais],
    tendencias: ["📈 Tendências", renderTendencias],
    checklist: ["Checklist do portfólio", renderChecklist]
  };
  const abaAtual = () => { const h = location.hash.replace("#", ""); return ABAS[h] ? h : "portfolio"; };
  function abrirMenu() { $("#menu").classList.add("aberto"); $("#menu-fundo").hidden = false; }
  function fecharMenu() { $("#menu").classList.remove("aberto"); $("#menu-fundo").hidden = true; }
  $("#abrir-menu").addEventListener("click", abrirMenu);
  $("#menu-fundo").addEventListener("click", fecharMenu);
  $("#sair").addEventListener("click", async () => {
    try { await banco.auth.signOut(); } catch (erro) { /* mesmo com erro, volta para o login */ }
    location.replace("../login/");
  });

  function mostrarAba() {
    const id = abaAtual();
    $$(".menu nav a").forEach((a) => a.classList.toggle("ativo", a.dataset.aba === id));
    $("#titulo-aba").textContent = ABAS[id][0];
    document.title = `${ABAS[id][0]} | Painel`;
    fecharMenu();
    const area = $("#area");
    try { ABAS[id][1](area); }
    catch (erro) {
      console.error(erro);
      area.innerHTML = `<div class="cartao"><p class="frase-vazia">Esta aba teve um problema para abrir. As outras abas continuam funcionando.</p></div>`;
    }
  }
  window.addEventListener("hashchange", mostrarAba);

  /* =================================================================
     ABA 1: PORTFÓLIO
     ================================================================= */
  const estadoVideos = { nicho: "todos" };
  const estadoMetricas = { dias: 14 };
  const nomeOrigem = (o) => (!o || o === "direto" ? "Link direto" : o);
  const NOMES_EVENTO = {
    video: "Vídeos abertos", whatsapp: "Cliques no WhatsApp", instagram: "Cliques no Instagram", email: "Cliques no e-mail",
    tiktok: "Cliques no TikTok", contato: "Botões de contato", formulario: "Formulários enviados", midia_kit: "Pedidos de mídia kit", nicho: "Nichos filtrados"
  };
  const ROTULO_ACAO = {
    video: "abriu o vídeo", whatsapp: "clicou no WhatsApp", instagram: "clicou no Instagram", email: "clicou no e-mail",
    tiktok: "clicou no TikTok", contato: "clicou em", formulario: "enviou o formulário de contato", midia_kit: "pediu o mídia kit", nicho: "filtrou o nicho"
  };
  function contar(lista, chave) {
    const c = {};
    lista.forEach((x) => { const k = chave(x); if (k) c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }
  function listaBarras(pares, vazio) {
    if (!pares.length) return `<p class="frase-vazia">${vazio}</p>`;
    return `<ul class="origens">${pares.map(([nome, n]) => `<li><div class="linha"><span>${esc(nome)}</span><b>${n}</b></div><div class="trilho"><i style="width:${(n / pares[0][1]) * 100}%"></i></div></li>`).join("")}</ul>`;
  }
  function quando(data) {
    const d = new Date(data);
    if (isNaN(d)) return "";
    const hora = `${dois(d.getHours())}:${dois(d.getMinutes())}`;
    if (isoLocal(d) === isoLocal(new Date())) return `hoje, ${hora}`;
    const ontem = hoje0(); ontem.setDate(ontem.getDate() - 1);
    if (isoLocal(d) === isoLocal(ontem)) return `ontem, ${hora}`;
    return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}, ${hora}`;
  }
  /* o detalhe de um vídeo aberto vem como "Nicho · códigoDoYouTube" */
  const partesVideo = (detalhe) => { const p = String(detalhe || "").split(" · "); return { nicho: p[0] || "", id: p[1] || "" }; };

  function renderPortfolio(area) {
    const N = estadoMetricas.dias;
    const inicio = hoje0(); inicio.setDate(inicio.getDate() - (N - 1));
    const dias = [];
    for (let i = N - 1; i >= 0; i--) { const d = hoje0(); d.setDate(d.getDate() - i); dias.push({ chave: isoLocal(d), d, n: 0 }); }
    const porChave = new Map(dias.map((x) => [x.chave, x]));
    const noPeriodo = (lista) => lista.filter((x) => { const d = new Date(x.data); return !isNaN(d) && d >= inicio; });
    const visitas = noPeriodo(dados.visitas);
    const eventos = noPeriodo(dados.eventos);
    visitas.forEach((v) => { const dia = porChave.get(isoLocal(new Date(v.data))); if (dia) dia.n++; });

    const totalVisitas = visitas.length;
    const visitasHoje = dias[dias.length - 1].n;
    const noAr = dados.videos.filter((v) => v.visivel !== false).length;
    const origens = contar(visitas, (v) => nomeOrigem(v.origem));
    const aparelhos = contar(visitas, (v) => (v.dispositivo === "celular" ? "Celular" : v.dispositivo === "computador" ? "Computador" : ""));
    const porTipo = {};
    eventos.forEach((e) => { porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1; });
    const qtd = (t) => porTipo[t] || 0;
    const contatos = qtd("whatsapp") + qtd("email") + qtd("formulario") + qtd("midia_kit");
    const taxa = totalVisitas > 0 ? Math.round((contatos / totalVisitas) * 100) : 0;

    const abertos = contar(eventos.filter((e) => e.tipo === "video"), (e) => `${e.alvo}||${e.detalhe || ""}`).slice(0, 8);
    const nichosProcurados = contar(eventos.filter((e) => e.tipo === "video" || e.tipo === "nicho"), (e) => (e.tipo === "nicho" ? e.alvo : partesVideo(e.detalhe).nicho));
    const contaNicho = {};
    dados.videos.forEach((v) => {
      if (v.visivel === false || !v.nicho || String(v.nicho).toLowerCase() === "destaques") return;
      contaNicho[v.nicho] = (contaNicho[v.nicho] || 0) + 1;
    });
    const nichoMaisVideos = Object.entries(contaNicho).sort((a, b) => b[1] - a[1])[0];
    const nichoForte = nichosProcurados.find(([n]) => n && n.toLowerCase() !== "destaques");
    const acoes = Object.keys(NOMES_EVENTO).map((t) => [NOMES_EVENTO[t], qtd(t)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const recentes = eventos.slice().sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 12);
    const maior = Math.max(1, ...dias.map((x) => x.n));
    const pulo = N > 14 ? 3 : 1;

    const grafico = totalVisitas === 0
      ? `<p class="frase-vazia">Quando as pessoas começarem a visitar o seu portfólio, aqui aparece uma barrinha para cada um dos últimos ${N} dias, mostrando quantas visitas chegaram em cada dia.</p>`
      : `<div class="grafico" style="grid-template-columns:repeat(${N}, minmax(0, 1fr))">${dias.map((x, i) => `<div class="barra ${i === dias.length - 1 ? "hoje" : ""}" title="${plural(x.n, "visita", "visitas")} em ${dois(x.d.getDate())}/${dois(x.d.getMonth() + 1)}"><b>${x.n || ""}</b><i style="height:${x.n ? Math.max(3, (x.n / maior) * 78) : 0}%"></i><span>${(dias.length - 1 - i) % pulo === 0 ? `${dois(x.d.getDate())}/${dois(x.d.getMonth() + 1)}` : "&nbsp;"}</span></div>`).join("")}</div>`;

    const listaAbertos = abertos.length === 0
      ? `<p class="frase-vazia">Quando alguém abrir um vídeo no seu site, ele aparece aqui, do mais assistido para o menos.</p>`
      : `<ul class="ranking">${abertos.map(([chave, n]) => {
          const [titulo, detalhe] = chave.split("||");
          const { nicho, id } = partesVideo(detalhe);
          return `<li>${id ? `<img class="capinha" src="https://i.ytimg.com/vi/${esc(id)}/default.jpg" alt="" loading="lazy">` : `<span class="capinha"></span>`}<div><strong>${esc(titulo || "Vídeo sem título")}</strong><small>${esc(nicho)}</small></div><b>${plural(n, "vez", "vezes")}</b></li>`;
        }).join("")}</ul>`;

    const listaRecentes = recentes.length === 0
      ? `<p class="frase-vazia">Aqui aparecem as últimas coisas que as pessoas fizeram no site: vídeo aberto, clique no WhatsApp, formulário enviado.</p>`
      : `<ul class="ranking atividade">${recentes.map((e) => `<li><span class="ponto t-${esc(e.tipo)}"></span><div><strong>${esc(ROTULO_ACAO[e.tipo] || e.tipo)} ${e.tipo === "contato" || e.tipo === "video" || e.tipo === "nicho" ? `"${esc(e.alvo)}"` : ""}</strong><small>${esc(nomeOrigem(e.origem))}${e.dispositivo ? ` · ${esc(e.dispositivo)}` : ""}</small></div><small>${quando(e.data)}</small></li>`).join("")}</ul>`;

    const nichos = Array.from(new Set(dados.videos.map((v) => v.nicho).filter(Boolean)));
    if (estadoVideos.nicho !== "todos" && !nichos.includes(estadoVideos.nicho)) estadoVideos.nicho = "todos";
    const lista = dados.videos.filter((v) => estadoVideos.nicho === "todos" || v.nicho === estadoVideos.nicho);

    area.innerHTML = `
      <div class="ferramentas">
        <div class="chips" role="group" aria-label="Período">
          ${[7, 14, 30].map((d) => `<button type="button" data-periodo="${d}" aria-pressed="${N === d}">${d} dias</button>`).join("")}
        </div>
        <span class="dica">Conta só o site publicado. Quando você abre pelo seu computador (localhost), não entra.</span>
      </div>
      <div class="faixa-numeros" style="--colunas:5">
        <div><span>Visitas em ${N} dias</span><strong>${totalVisitas}</strong></div>
        <div><span>Visitas hoje</span><strong>${visitasHoje}</strong></div>
        <div><span>Vídeos no ar</span><strong>${noAr}</strong></div>
        <div><span>Nicho mais forte</span><strong>${nichoForte ? esc(nichoForte[0]) : nichoMaisVideos ? esc(nichoMaisVideos[0]) : "Ainda sem vídeos"}</strong><small>${nichoForte ? `mais procurado: ${plural(nichoForte[1], "vez", "vezes")}` : nichoMaisVideos ? `com mais vídeos (${nichoMaisVideos[1]})` : ""}</small></div>
        <div><span>De onde mais vêm</span><strong>${origens.length ? esc(origens[0][0]) : "Ainda sem visitas"}</strong>${origens.length ? `<small>${plural(origens[0][1], "visita", "visitas")}</small>` : ""}</div>
      </div>
      <div class="faixa-numeros" style="--colunas:5">
        <div><span>Vídeos abertos</span><strong>${qtd("video")}</strong></div>
        <div><span>Cliques no WhatsApp</span><strong>${qtd("whatsapp")}</strong></div>
        <div><span>Cliques no Instagram</span><strong>${qtd("instagram")}</strong></div>
        <div><span>Pedidos de contato</span><strong>${contatos}</strong><small>WhatsApp, e-mail, formulário e mídia kit</small></div>
        <div><span>Taxa de contato</span><strong>${taxa}%</strong><small>${totalVisitas ? `${contatos} a cada ${totalVisitas} visitas` : "aparece quando tiver visitas"}</small></div>
      </div>
      <div class="duas-colunas">
        <section class="cartao"><h2>Visitas nos últimos ${N} dias</h2>${grafico}</section>
        <section class="cartao"><h2>Por onde as pessoas chegaram</h2>${listaBarras(origens, "Aqui vai aparecer de onde as pessoas chegam no seu portfólio, como Instagram, WhatsApp, Google ou link direto.")}
          ${aparelhos.length ? `<h2 style="margin-top:16px">Celular ou computador</h2>${listaBarras(aparelhos, "")}` : ""}</section>
      </div>
      <div class="duas-colunas">
        <section class="cartao"><h2>Vídeos mais abertos no site</h2>${listaAbertos}</section>
        <section class="cartao"><h2>O que as pessoas fizeram</h2>${listaBarras(acoes, "Aqui aparecem os cliques no WhatsApp, Instagram, e-mail, botões de contato, formulários e vídeos abertos.")}
          ${nichosProcurados.length ? `<h2 style="margin-top:16px">Nichos mais procurados</h2>${listaBarras(nichosProcurados.slice(0, 6), "")}` : ""}</section>
      </div>
      <section class="cartao"><h2>Atividade recente</h2>${listaRecentes}</section>
      <section class="cartao">
        <div class="cartao-topo">
          <h2>Meus vídeos</h2>
          <div class="ferramentas">
            <select class="filtro" id="filtro-nicho" aria-label="Filtrar por nicho">
              <option value="todos">Todos os nichos</option>
              ${nichos.map((n) => `<option value="${esc(n)}" ${estadoVideos.nicho === n ? "selected" : ""}>${esc(n)}</option>`).join("")}
            </select>
            <button type="button" class="botao botao-principal" id="add-video"><svg class="ic"><use href="#i-mais"/></svg>Adicionar vídeo</button>
          </div>
        </div>
        <p class="dica" style="margin-bottom:10px">Arraste pela alcinha para mudar a ordem. O olhinho mostra ou esconde o vídeo no site. Vídeos do nicho "Destaques" aparecem na seção Conteúdos de destaque.</p>
        ${lista.length === 0 ? `<p class="frase-vazia">Nenhum vídeo ainda. Clique em Adicionar vídeo para colocar o primeiro.</p>` : `
        <div class="tabela-caixa"><table>
          <thead><tr><th></th><th></th><th>Título</th><th>Nicho</th><th>Marca</th><th>Destaque</th><th>Formato</th><th></th></tr></thead>
          <tbody id="corpo-videos">
            ${lista.map((v) => {
              const id = idYT(v.link);
              return `<tr data-id="${v.id}" class="${v.visivel === false ? "apagado" : ""}">
                <td style="width:30px"><span class="alca" title="Arraste para mudar a ordem" aria-label="Arrastar"><svg class="ic"><use href="#i-alca"/></svg></span></td>
                <td style="width:44px">${id ? `<img class="capinha" src="https://i.ytimg.com/vi/${id}/default.jpg" alt="" loading="lazy">` : `<span class="capinha"></span>`}</td>
                <td>${v.titulo ? esc(v.titulo) : `<span class="dica">Sem título</span>`}</td>
                <td>${esc(v.nicho)}</td>
                <td>${esc(v.marca)}</td>
                <td>${esc(v.destaque)}</td>
                <td>${esc(v.formato)}</td>
                <td class="acoes">
                  <button type="button" class="botao-icone" data-acao="olho" title="${v.visivel === false ? "Escondido no site. Clique para mostrar" : "Aparece no site. Clique para esconder"}"><svg class="ic"><use href="#${v.visivel === false ? "i-olho-fechado" : "i-olho"}"/></svg></button>
                  <button type="button" class="botao-icone" data-acao="editar" title="Editar"><svg class="ic"><use href="#i-lapis"/></svg></button>
                  <button type="button" class="botao-icone" data-acao="apagar" title="Apagar"><svg class="ic"><use href="#i-lixo"/></svg></button>
                </td></tr>`;
            }).join("")}
          </tbody></table></div>`}
      </section>`;

    $("#filtro-nicho").addEventListener("change", (e) => { estadoVideos.nicho = e.target.value; renderPortfolio(area); });
    $$("[data-periodo]", area).forEach((b) => b.addEventListener("click", () => { estadoMetricas.dias = Number(b.dataset.periodo); renderPortfolio(area); }));
    $("#add-video").addEventListener("click", () => formVideo());
    const corpo = $("#corpo-videos");
    if (!corpo) return;
    corpo.addEventListener("click", async (e) => {
      const botao = e.target.closest("[data-acao]");
      if (!botao) return;
      const v = dados.videos.find((x) => String(x.id) === botao.closest("tr").dataset.id);
      if (!v) return;
      if (botao.dataset.acao === "editar") formVideo(v);
      if (botao.dataset.acao === "apagar") {
        if (!confirm("Apagar este vídeo de vez?")) return;
        if (await apagar("videos", v.id)) { dados.videos = dados.videos.filter((x) => x.id !== v.id); recado("Vídeo apagado"); renderPortfolio(area); }
      }
      if (botao.dataset.acao === "olho") {
        const linha = await gravar("videos", { visivel: v.visivel === false }, v.id);
        if (linha) { trocarNaLista(dados.videos, linha); recado(linha.visivel ? "Agora aparece no site" : "Escondido do site"); renderPortfolio(area); }
      }
    });
    /* arrastar pela alcinha */
    let arrastada = null;
    corpo.addEventListener("mousedown", (e) => { const tr = e.target.closest("tr"); if (tr) tr.draggable = !!e.target.closest(".alca"); });
    corpo.addEventListener("dragstart", (e) => {
      const tr = e.target.closest("tr");
      if (!tr || !tr.draggable) { e.preventDefault(); return; }
      arrastada = tr; tr.classList.add("arrastando");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tr.dataset.id);
    });
    corpo.addEventListener("dragover", (e) => {
      if (!arrastada) return;
      e.preventDefault();
      const tr = e.target.closest("tr");
      if (!tr || tr === arrastada) return;
      const r = tr.getBoundingClientRect();
      corpo.insertBefore(arrastada, e.clientY > r.top + r.height / 2 ? tr.nextSibling : tr);
    });
    corpo.addEventListener("dragend", async () => {
      if (!arrastada) return;
      arrastada.classList.remove("arrastando");
      arrastada.draggable = false;
      arrastada = null;
      await salvarOrdem(corpo);
      renderPortfolio(area);
    });
  }

  async function salvarOrdem(corpo) {
    const ids = $$("tr", corpo).map((tr) => tr.dataset.id);
    const linhas = ids.map((id) => dados.videos.find((v) => String(v.id) === id)).filter(Boolean);
    /* usa as mesmas posições que esses vídeos já ocupavam, só que na nova sequência */
    let posicoes = linhas.map((v) => numero(v.ordem)).sort((a, b) => a - b);
    if (new Set(posicoes).size !== posicoes.length) posicoes = linhas.map((_, i) => (i + 1) * 10);
    const mudou = linhas.map((v, i) => ({ v, nova: posicoes[i] })).filter((x) => numero(x.v.ordem) !== x.nova);
    if (!mudou.length) return;
    try {
      const resultados = await Promise.all(mudou.map((x) => banco.from("videos").update({ ordem: x.nova }).eq("id", x.v.id)));
      const erro = resultados.find((r) => r.error);
      if (erro) throw erro.error;
      mudou.forEach((x) => { x.v.ordem = x.nova; });
      dados.videos.sort((a, b) => numero(a.ordem) - numero(b.ordem) || a.id - b.id);
      recado("Ordem salva. O site já mostra assim.");
    } catch (erro) {
      recado(traduzErro(erro, "videos"), true);
    }
  }

  function formVideo(v) {
    const nichos = Array.from(new Set(["Destaques"].concat(dados.videos.map((x) => x.nicho).filter(Boolean))));
    const maiorOrdem = dados.videos.reduce((m, x) => Math.max(m, numero(x.ordem)), 0);
    formulario({
      titulo: v ? "Editar vídeo" : "Adicionar vídeo",
      valores: v || { formato: "Vertical 9:16", visivel: true, ordem: maiorOrdem + 10 },
      campos: [
        { nome: "titulo", rotulo: "Título", inteira: true, dica: "Se deixar vazio, o site mostra o nome do nicho com o número do vídeo." },
        { nome: "link", rotulo: "Link do vídeo", tipo: "url", obrigatorio: true, inteira: true, dica: "Link do YouTube (Shorts ou vídeo normal)." },
        { nome: "nicho", rotulo: "Nicho", obrigatorio: true, lista: nichos, dica: "Use \"Destaques\" para a seção Conteúdos de destaque." },
        { nome: "formato", rotulo: "Formato" },
        { nome: "marca", rotulo: "Marca" },
        { nome: "destaque", rotulo: "Destaque", dica: "Ex: 2,4M views. Aparece no card de destaque." },
        { nome: "ordem", rotulo: "Ordem", tipo: "number", dica: "O menor aparece primeiro." },
        { nome: "visivel", rotulo: "Aparece no site", tipo: "checkbox" }
      ],
      aoSalvar: async (obj) => {
        if (!idYT(obj.link)) { recado("Esse link não parece ser do YouTube. Confira e tente de novo.", true); return false; }
        const linha = await gravar("videos", obj, v && v.id);
        if (!linha) return false;
        trocarNaLista(dados.videos, linha);
        dados.videos.sort((a, b) => numero(a.ordem) - numero(b.ordem) || a.id - b.id);
        recado("Vídeo salvo. O site já mostra a mudança.");
        renderPortfolio($("#area"));
        return true;
      },
      aoApagar: v ? async () => {
        if (!(await apagar("videos", v.id))) return false;
        dados.videos = dados.videos.filter((x) => x.id !== v.id);
        recado("Vídeo apagado");
        renderPortfolio($("#area"));
        return true;
      } : null
    });
  }

  /* =================================================================
     ABA 2: MARCAS
     ================================================================= */
  const SITUACOES = [["lead", "Lead"], ["conversando", "Conversando"], ["cliente", "Cliente"], ["parada", "Parada"]];
  const nomeSituacao = (s) => (SITUACOES.find((x) => x[0] === s) || [s, s || ""])[1];
  const estadoMarcas = { busca: "", situacao: "todas" };
  const linkInsta = (arroba) => { const u = String(arroba || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, ""); return u ? `https://www.instagram.com/${encodeURIComponent(u)}/` : ""; };
  const linkZap = (tel) => { let d = String(tel || "").replace(/\D/g, ""); if (!d || /^0+$/.test(d)) return ""; if (d.length === 10 || d.length === 11) d = "55" + d; return d.length >= 12 ? `https://wa.me/${d}` : ""; };

  function marcasFiltradas() {
    const b = estadoMarcas.busca.toLowerCase();
    return dados.marcas.filter((m) =>
      (estadoMarcas.situacao === "todas" || m.situacao === estadoMarcas.situacao) &&
      (!b || [m.nome, m.instagram, m.email].some((c) => String(c || "").toLowerCase().includes(b))));
  }

  function renderMarcas(area) {
    const conta = (s) => dados.marcas.filter((m) => m.situacao === s).length;
    area.innerHTML = `
      <div class="faixa-numeros" style="--colunas:5">
        <div><span>Total na base</span><strong>${dados.marcas.length}</strong></div>
        ${SITUACOES.map(([s, nome]) => `<div><span>${nome}</span><strong>${conta(s)}</strong></div>`).join("")}
      </div>
      <section class="cartao">
        <div class="ferramentas" style="margin-bottom:12px">
          <input class="campo-busca" id="busca-marcas" type="search" placeholder="Buscar por nome, @ ou e-mail" value="${esc(estadoMarcas.busca)}">
          <select class="filtro" id="filtro-situacao" aria-label="Filtrar por situação">
            <option value="todas">Todas as situações</option>
            ${SITUACOES.map(([s, n]) => `<option value="${s}" ${estadoMarcas.situacao === s ? "selected" : ""}>${n}</option>`).join("")}
          </select>
          <span class="espaco"></span>
          <button type="button" class="botao botao-leve" id="csv-marcas"><svg class="ic"><use href="#i-baixar"/></svg>Baixar CSV</button>
          <button type="button" class="botao botao-principal" id="add-marca"><svg class="ic"><use href="#i-mais"/></svg>Adicionar marca</button>
        </div>
        <div id="tabela-marcas"></div>
      </section>`;
    desenharTabelaMarcas();
    $("#busca-marcas").addEventListener("input", (e) => { estadoMarcas.busca = e.target.value; desenharTabelaMarcas(); });
    $("#filtro-situacao").addEventListener("change", (e) => { estadoMarcas.situacao = e.target.value; desenharTabelaMarcas(); });
    $("#add-marca").addEventListener("click", () => formMarca());
    $("#csv-marcas").addEventListener("click", () => {
      baixarCSV(`marcas-${isoLocal(new Date())}.csv`,
        ["Marca", "Instagram", "E-mail", "Telefone", "Situação", "Observação", "Último contato"],
        marcasFiltradas().map((m) => [m.nome, m.instagram, m.email, m.telefone, nomeSituacao(m.situacao), m.obs, dataBR(m.ultimo_contato)]));
    });
  }

  function desenharTabelaMarcas() {
    const caixa = $("#tabela-marcas");
    if (!caixa) return;
    const lista = marcasFiltradas();
    if (!lista.length) {
      caixa.innerHTML = `<p class="frase-vazia">${dados.marcas.length ? "Nenhuma marca encontrada com essa busca." : "Sua base ainda está vazia. As marcas que mandarem mensagem pelo formulário do site aparecem aqui como Lead."}</p>`;
      return;
    }
    caixa.innerHTML = `<div class="tabela-caixa"><table>
      <thead><tr><th>Marca</th><th>Instagram</th><th>E-mail</th><th>Telefone</th><th>Situação</th><th>Observação</th><th>Último contato</th><th></th></tr></thead>
      <tbody>${lista.map((m) => {
        const insta = linkInsta(m.instagram), zap = linkZap(m.telefone);
        return `<tr class="clicavel" data-id="${m.id}">
          <td><strong>${esc(m.nome)}</strong></td>
          <td>${insta ? `<a href="${insta}" target="_blank" rel="noopener" data-link>${esc(m.instagram)}</a>` : esc(m.instagram)}</td>
          <td>${m.email ? `<a href="mailto:${esc(m.email)}" data-link>${esc(m.email)}</a>` : ""}</td>
          <td style="white-space:nowrap">${esc(m.telefone)}</td>
          <td><span class="pilula p-${esc(m.situacao)}">${esc(nomeSituacao(m.situacao))}</span></td>
          <td class="truncar" title="${esc(m.obs)}">${esc(m.obs)}</td>
          <td>${dataBR(m.ultimo_contato)}</td>
          <td class="acoes">
            ${zap ? `<a class="botao-icone" href="${zap}" target="_blank" rel="noopener" title="Abrir no WhatsApp" data-link><svg class="ic"><use href="#i-zap"/></svg></a>` : ""}
            ${insta ? `<a class="botao-icone" href="${insta}" target="_blank" rel="noopener" title="Abrir o Instagram" data-link><svg class="ic"><use href="#i-insta"/></svg></a>` : ""}
          </td></tr>`;
      }).join("")}</tbody></table></div>`;
    caixa.querySelector("tbody").addEventListener("click", (e) => {
      if (e.target.closest("[data-link]")) return;
      const tr = e.target.closest("tr");
      const m = tr && dados.marcas.find((x) => String(x.id) === tr.dataset.id);
      if (m) formMarca(m);
    });
  }

  function formMarca(m) {
    formulario({
      titulo: m ? "Editar marca" : "Adicionar marca",
      valores: m || { situacao: "lead", ultimo_contato: isoLocal(new Date()) },
      campos: [
        { nome: "nome", rotulo: "Marca", obrigatorio: true, inteira: true },
        { nome: "instagram", rotulo: "Instagram", dica: "Ex: @nomedamarca" },
        { nome: "email", rotulo: "E-mail", tipo: "email" },
        { nome: "telefone", rotulo: "Telefone", tipo: "tel", dica: "Com DDD, para abrir o WhatsApp." },
        { nome: "situacao", rotulo: "Situação", tipo: "select", opcoes: SITUACOES },
        { nome: "ultimo_contato", rotulo: "Último contato", tipo: "date" },
        { nome: "obs", rotulo: "Observação", tipo: "textarea" }
      ],
      aoSalvar: async (obj) => {
        const linha = await gravar("marcas", obj, m && m.id);
        if (!linha) return false;
        if (m) trocarNaLista(dados.marcas, linha); else dados.marcas.unshift(linha);
        recado("Marca salva");
        renderMarcas($("#area"));
        return true;
      },
      aoApagar: m ? async () => {
        if (!(await apagar("marcas", m.id))) return false;
        dados.marcas = dados.marcas.filter((x) => x.id !== m.id);
        recado("Marca apagada");
        renderMarcas($("#area"));
        return true;
      } : null
    });
  }

  /* =================================================================
     ABA 3: CALENDÁRIO
     ================================================================= */
  const TIPOS_CAL = [["gravar", "Gravar"], ["editar", "Editar"], ["postar", "Postar"]];
  const nomeTipoCal = (t) => (TIPOS_CAL.find((x) => x[0] === t) || [t, t])[1];
  const estadoCal = { mes: (() => { const d = hoje0(); d.setDate(1); return d; })(), filtro: "todos" };

  /* junta o que está no calendário com os prazos das campanhas */
  function itensDoCalendario() {
    const itens = dados.calendario.filter((c) => c.data).map((c) => ({
      origem: "cal", id: c.id, data: String(c.data).slice(0, 10), tipo: c.tipo || "gravar",
      texto: c.titulo + (c.marca ? ` · ${c.marca}` : ""), feito: c.status === "feito"
    }));
    dados.campanhas.filter((c) => c.prazo).forEach((c) => itens.push({
      origem: "camp", id: c.id, data: String(c.prazo).slice(0, 10), tipo: "prazo",
      texto: `Prazo: ${c.campanha}${c.cliente ? ` · ${c.cliente}` : ""}`, feito: c.status === "Entregue"
    }));
    return itens.filter((i) => estadoCal.filtro === "todos" || i.tipo === estadoCal.filtro);
  }
  function chipItem(i) {
    return `<button type="button" class="cal-item t-${esc(i.tipo)} ${i.feito ? "feito" : ""}" data-origem="${i.origem}" data-id="${i.id}" title="${esc(i.texto)}">${esc(i.texto)}</button>`;
  }

  function renderCalendario(area) {
    const mes = estadoCal.mes;
    const nomeMesBruto = mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const nomeMes = nomeMesBruto.charAt(0).toUpperCase() + nomeMesBruto.slice(1);
    const inicio = new Date(mes); inicio.setDate(1 - ((mes.getDay() + 6) % 7));
    const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const fim = new Date(fimMes); fim.setDate(fimMes.getDate() + (6 - ((fimMes.getDay() + 6) % 7)));
    const itens = itensDoCalendario();
    const porDia = {};
    itens.forEach((i) => { (porDia[i.data] = porDia[i.data] || []).push(i); });
    const hojeISO = isoLocal(new Date());
    const celulas = [];
    for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
      const chave = isoLocal(d);
      const doDia = porDia[chave] || [];
      celulas.push(`<div class="cal-dia ${d.getMonth() !== mes.getMonth() ? "fora" : ""} ${chave === hojeISO ? "hoje" : ""}" data-dia="${chave}">
        <span class="cal-num">${d.getDate()}</span>
        <button type="button" class="cal-mais-dia" data-novo="${chave}" title="Adicionar neste dia" aria-label="Adicionar em ${dataBR(chave)}"><svg class="ic"><use href="#i-mais"/></svg></button>
        ${doDia.slice(0, 3).map(chipItem).join("")}
        ${doDia.length > 3 ? `<button type="button" class="cal-ver-mais" data-ver="${chave}">+${doDia.length - 3} mais</button>` : ""}
      </div>`);
    }

    /* ficou pra trás: o que passou do dia e não foi feito */
    const hoje = hoje0();
    const atrasados = [];
    dados.calendario.forEach((c) => { const d = deISO(c.data); if (d && d < hoje && c.status !== "feito") atrasados.push({ tipo: nomeTipoCal(c.tipo), texto: c.titulo + (c.marca ? ` · ${c.marca}` : ""), dias: Math.round((hoje - d) / 86400000), origem: "cal", id: c.id }); });
    dados.campanhas.forEach((c) => { const d = deISO(c.prazo); if (d && d < hoje && c.status !== "Entregue") atrasados.push({ tipo: "Prazo de campanha", texto: c.campanha + (c.cliente ? ` · ${c.cliente}` : ""), dias: Math.round((hoje - d) / 86400000), origem: "camp", id: c.id }); });
    atrasados.sort((a, b) => b.dias - a.dias);

    area.innerHTML = `
      <section class="cartao">
        <div class="cal-topo">
          <button type="button" class="botao-icone" id="mes-antes" aria-label="Mês anterior"><svg class="ic"><use href="#i-seta-esq"/></svg></button>
          <h2>${esc(nomeMes)}</h2>
          <button type="button" class="botao-icone" id="mes-depois" aria-label="Próximo mês"><svg class="ic"><use href="#i-seta-dir"/></svg></button>
          <button type="button" class="botao botao-leve" id="este-mes">Este mês</button>
          <span class="espaco" style="flex:1"></span>
          <div class="chips" role="group" aria-label="Filtrar por tipo">
            ${[["todos", "Todos"]].concat(TIPOS_CAL, [["prazo", "Prazos"]]).map(([v, t]) => `<button type="button" data-filtro="${v}" aria-pressed="${estadoCal.filtro === v}">${t}</button>`).join("")}
          </div>
          <button type="button" class="botao botao-principal" id="add-cal"><svg class="ic"><use href="#i-mais"/></svg>Adicionar</button>
        </div>
        <div class="cal-grade">
          ${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((s) => `<div class="cal-semana">${s}</div>`).join("")}
          ${celulas.join("")}
        </div>
        <div class="legenda"><span><i class="t-gravar"></i>Gravar</span><span><i class="t-editar"></i>Editar</span><span><i class="t-postar"></i>Postar</span><span><i class="t-prazo"></i>Prazo de campanha</span></div>
      </section>
      <section class="cartao" id="atrasados">
        <h2>Ficou pra trás</h2>
        ${atrasados.length ? `<ul class="atrasados">${atrasados.map((a) => `<li><span class="pilula">${esc(a.tipo)}</span><span>${esc(a.texto)}</span><span class="quanto">há ${plural(a.dias, "dia", "dias")}</span>${a.origem === "cal" ? `<button type="button" class="botao botao-leve" data-feito="${a.id}">Marcar como feito</button>` : `<button type="button" class="botao botao-leve" data-camp="${a.id}">Abrir campanha</button>`}</li>`).join("")}</ul>` : `<p class="frase-vazia">Nada atrasado. Tudo em dia.</p>`}
      </section>`;

    $("#mes-antes").addEventListener("click", () => { estadoCal.mes = new Date(mes.getFullYear(), mes.getMonth() - 1, 1); renderCalendario(area); });
    $("#mes-depois").addEventListener("click", () => { estadoCal.mes = new Date(mes.getFullYear(), mes.getMonth() + 1, 1); renderCalendario(area); });
    $("#este-mes").addEventListener("click", () => { estadoCal.mes = (() => { const d = hoje0(); d.setDate(1); return d; })(); renderCalendario(area); });
    $$(".chips [data-filtro]", area).forEach((b) => b.addEventListener("click", () => { estadoCal.filtro = b.dataset.filtro; renderCalendario(area); }));
    $("#add-cal").addEventListener("click", () => formCalendario(null, isoLocal(new Date())));
    $(".cal-grade", area).addEventListener("click", (e) => {
      const item = e.target.closest(".cal-item");
      if (item) { abrirItem(item.dataset.origem, item.dataset.id); return; }
      const ver = e.target.closest("[data-ver]");
      if (ver) { abrirDia(ver.dataset.ver); return; }
      const novo = e.target.closest("[data-novo]");
      if (novo) { formCalendario(null, novo.dataset.novo); return; }
      const dia = e.target.closest(".cal-dia");
      if (dia) formCalendario(null, dia.dataset.dia);
    });
    $("#atrasados", area).addEventListener("click", async (e) => {
      const feito = e.target.closest("[data-feito]");
      if (feito) {
        feito.disabled = true;
        const linha = await gravar("calendario", { status: "feito" }, Number(feito.dataset.feito));
        if (linha) { trocarNaLista(dados.calendario, linha); recado("Marcado como feito"); renderCalendario(area); }
        else feito.disabled = false;
      }
      const camp = e.target.closest("[data-camp]");
      if (camp) { const c = dados.campanhas.find((x) => String(x.id) === camp.dataset.camp); if (c) formCampanha(c); }
    });
  }

  function abrirItem(origem, id) {
    if (origem === "camp") { const c = dados.campanhas.find((x) => String(x.id) === String(id)); if (c) formCampanha(c); return; }
    const c = dados.calendario.find((x) => String(x.id) === String(id));
    if (c) formCalendario(c);
  }
  function abrirDia(chave) {
    const itens = itensDoCalendario().filter((i) => i.data === chave);
    abrirModal(`Dia ${dataBR(chave)}`, `<ul class="lista-dia">${itens.map((i) => `<li>${chipItem(i)}</li>`).join("")}</ul>
      <div class="form-acoes"><button type="button" class="botao botao-principal" id="dia-novo"><svg class="ic"><use href="#i-mais"/></svg>Adicionar neste dia</button></div>`);
    $(".lista-dia").addEventListener("click", (e) => { const b = e.target.closest(".cal-item"); if (b) abrirItem(b.dataset.origem, b.dataset.id); });
    $("#dia-novo").addEventListener("click", () => formCalendario(null, chave));
  }
  function formCalendario(c, data) {
    formulario({
      titulo: c ? "Editar no calendário" : "Adicionar no calendário",
      valores: c || { tipo: "gravar", status: "a fazer", data },
      campos: [
        { nome: "titulo", rotulo: "O que é", obrigatorio: true, inteira: true },
        { nome: "marca", rotulo: "Marca", lista: dados.marcas.map((m) => m.nome) },
        { nome: "data", rotulo: "Data", tipo: "date", obrigatorio: true },
        { nome: "tipo", rotulo: "Tipo", tipo: "select", opcoes: TIPOS_CAL },
        { nome: "status", rotulo: "Status", tipo: "select", opcoes: [["a fazer", "A fazer"], ["feito", "Feito"]] }
      ],
      aoSalvar: async (obj) => {
        const linha = await gravar("calendario", obj, c && c.id);
        if (!linha) return false;
        trocarNaLista(dados.calendario, linha);
        recado("Salvo no calendário");
        renderCalendario($("#area"));
        return true;
      },
      aoApagar: c ? async () => {
        if (!(await apagar("calendario", c.id))) return false;
        dados.calendario = dados.calendario.filter((x) => x.id !== c.id);
        recado("Apagado do calendário");
        renderCalendario($("#area"));
        return true;
      } : null
    });
  }

  /* =================================================================
     ABA 4: CAMPANHAS
     ================================================================= */
  const FUNIL = ["Briefing", "Roteiro", "Aprovação Roteiro", "Gravação", "Edição", "Aprovado", "Entregue"];
  const estadoCamp = { filtro: "todas", busca: "", coluna: null, sentido: 1 };
  const COLUNAS = [
    ["favorita", "", "bool"], ["campanha", "Campanha", "texto"], ["cliente", "Cliente", "texto"], ["tipo", "Tipo", "texto"],
    ["status", "Status", "funil"], ["qtd", "Qtd", "numero"], ["valor", "Valor", "numero"], ["prazo", "Prazo", "data"], ["pagamento", "Pagamento", "texto"]
  ];
  function comparar(a, b, coluna, tipo) {
    const va = a[coluna], vb = b[coluna];
    if (tipo === "funil") return FUNIL.indexOf(va) - FUNIL.indexOf(vb);
    if (tipo === "numero") return numero(va) - numero(vb);
    if (tipo === "bool") return (va ? 1 : 0) - (vb ? 1 : 0);
    if (tipo === "data") { if (!va && !vb) return 0; if (!va) return 1; if (!vb) return -1; return String(va).localeCompare(String(vb)); }
    return String(va || "").localeCompare(String(vb || ""), "pt-BR", { sensitivity: "base" });
  }
  function campanhasVisiveis() {
    const b = estadoCamp.busca.toLowerCase();
    let lista = dados.campanhas.filter((c) =>
      (estadoCamp.filtro === "todas" || (estadoCamp.filtro === "ativas" ? c.ativa !== false : c.ativa === false)) &&
      (!b || [c.campanha, c.cliente].some((x) => String(x || "").toLowerCase().includes(b))));
    if (estadoCamp.coluna) {
      const tipo = (COLUNAS.find((x) => x[0] === estadoCamp.coluna) || [])[2];
      lista = lista.slice().sort((a, b2) => comparar(a, b2, estadoCamp.coluna, tipo) * estadoCamp.sentido || b2.id - a.id);
    } else {
      lista = lista.slice().sort((a, b2) => comparar(b2, a, "favorita", "bool") || comparar(a, b2, "prazo", "data"));
    }
    return lista;
  }
  function avisoPrazo(c) {
    if (!c.prazo || c.status === "Entregue") return "";
    const d = diasAte(c.prazo);
    if (d == null) return "";
    if (d < 0) return `<span class="etiqueta-prazo atrasado">atrasado ${plural(-d, "dia", "dias")}</span>`;
    if (d === 0) return `<span class="etiqueta-prazo vence">vence hoje</span>`;
    if (d <= 3) return `<span class="etiqueta-prazo vence">vence em ${plural(d, "dia", "dias")}</span>`;
    return "";
  }

  function renderCampanhas(area) {
    const lista = dados.campanhas;
    const somaValor = lista.reduce((s, c) => s + numero(c.valor), 0);
    const somaQtd = lista.reduce((s, c) => s + numero(c.qtd), 0);
    const ticket = somaQtd > 0 ? somaValor / somaQtd : 0;
    const aReceber = lista.filter((c) => c.pagamento !== "pago").reduce((s, c) => s + numero(c.valor), 0);
    const recebido = lista.filter((c) => c.pagamento === "pago").reduce((s, c) => s + numero(c.valor), 0);
    area.innerHTML = `
      <div class="faixa-numeros" style="--colunas:4">
        <div><span>Total de campanhas</span><strong>${lista.length}</strong></div>
        <div><span>Ativas</span><strong>${lista.filter((c) => c.ativa !== false).length}</strong></div>
        <div><span>Valor total</span><strong>${moeda(somaValor)}</strong><small>ticket médio de ${moeda(ticket)} por vídeo</small></div>
        <div><span>A receber</span><strong>${moeda(aReceber)}</strong><small>já recebido: ${moeda(recebido)}</small></div>
      </div>
      <section class="cartao">
        <div class="ferramentas" style="margin-bottom:12px">
          <div class="chips" role="group" aria-label="Filtrar campanhas">
            ${[["todas", "Todas"], ["ativas", "Ativas"], ["finalizadas", "Finalizadas"]].map(([v, t]) => `<button type="button" data-filtro="${v}" aria-pressed="${estadoCamp.filtro === v}">${t}</button>`).join("")}
          </div>
          <input class="campo-busca" id="busca-camp" type="search" placeholder="Buscar campanha ou cliente" value="${esc(estadoCamp.busca)}">
          <span class="espaco"></span>
          <button type="button" class="botao botao-leve" id="csv-camp"><svg class="ic"><use href="#i-baixar"/></svg>Baixar</button>
          <button type="button" class="botao botao-principal" id="add-camp"><svg class="ic"><use href="#i-mais"/></svg>Adicionar campanha</button>
        </div>
        <div id="tabela-camp"></div>
      </section>`;
    desenharTabelaCamp();
    $$(".chips [data-filtro]", area).forEach((b) => b.addEventListener("click", () => { estadoCamp.filtro = b.dataset.filtro; renderCampanhas(area); }));
    $("#busca-camp").addEventListener("input", (e) => { estadoCamp.busca = e.target.value; desenharTabelaCamp(); });
    $("#add-camp").addEventListener("click", () => formCampanha());
    $("#csv-camp").addEventListener("click", () => {
      baixarCSV(`campanhas-${isoLocal(new Date())}.csv`,
        ["Favorita", "Campanha", "Cliente", "Tipo", "Status", "Qtd", "Valor", "Prazo", "Pagamento", "Ativa"],
        campanhasVisiveis().map((c) => [c.favorita ? "sim" : "", c.campanha, c.cliente, c.tipo, c.status, numero(c.qtd), numero(c.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 }), dataBR(c.prazo), c.pagamento === "pago" ? "Pago" : "Pendente", c.ativa === false ? "não" : "sim"]));
    });
  }

  function desenharTabelaCamp() {
    const caixa = $("#tabela-camp");
    if (!caixa) return;
    const lista = campanhasVisiveis();
    const cabecalho = COLUNAS.map(([col, rotulo]) => {
      const ativa = estadoCamp.coluna === col;
      const seta = ativa ? (estadoCamp.sentido === 1 ? "▲" : "▼") : "↕";
      return `<th class="ordenavel ${ativa ? "ordenando" : ""}" data-coluna="${col}" title="Ordenar">${rotulo || "★"}<span class="seta">${seta}</span></th>`;
    }).join("");
    if (!lista.length) {
      caixa.innerHTML = `<p class="frase-vazia">${dados.campanhas.length ? "Nenhuma campanha com esse filtro." : "Nenhuma campanha ainda. Clique em Adicionar campanha para cadastrar a primeira."}</p>`;
      return;
    }
    caixa.innerHTML = `<div class="tabela-caixa"><table>
      <thead><tr>${cabecalho}</tr></thead>
      <tbody>${lista.map((c) => {
        const passo = Math.max(0, FUNIL.indexOf(c.status));
        return `<tr class="clicavel ${c.favorita ? "favorita" : ""}" data-id="${c.id}">
          <td style="width:36px"><button type="button" class="botao-icone ${c.favorita ? "ligado" : ""}" data-estrela title="${c.favorita ? "Tirar destaque" : "Destacar"}"><svg class="ic"><use href="#i-estrela"/></svg></button></td>
          <td><strong>${esc(c.campanha)}</strong></td>
          <td>${esc(c.cliente)}</td>
          <td><span class="pilula ${c.tipo === "Publicidade" ? "p-publicidade" : "p-conteudo"}">${esc(c.tipo)}</span></td>
          <td><span class="pilula p-s${passo}">${esc(c.status)}</span></td>
          <td>${numero(c.qtd)}</td>
          <td style="white-space:nowrap">${moeda(c.valor)}</td>
          <td style="white-space:nowrap">${dataBR(c.prazo)}${avisoPrazo(c)}</td>
          <td><span class="pilula ${c.pagamento === "pago" ? "p-pago" : "p-pendente"}">${c.pagamento === "pago" ? "Pago" : "Pendente"}</span></td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
    $$("th[data-coluna]", caixa).forEach((th) => th.addEventListener("click", () => {
      const col = th.dataset.coluna;
      if (estadoCamp.coluna === col) estadoCamp.sentido *= -1; else { estadoCamp.coluna = col; estadoCamp.sentido = 1; }
      desenharTabelaCamp();
    }));
    caixa.querySelector("tbody").addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const c = tr && dados.campanhas.find((x) => String(x.id) === tr.dataset.id);
      if (!c) return;
      if (e.target.closest("[data-estrela]")) {
        const linha = await gravar("campanhas", { favorita: !c.favorita }, c.id);
        if (linha) { trocarNaLista(dados.campanhas, linha); desenharTabelaCamp(); }
        return;
      }
      formCampanha(c);
    });
  }

  function formCampanha(c) {
    formulario({
      titulo: c ? "Editar campanha" : "Adicionar campanha",
      valores: c || { tipo: "Conteúdo", status: "Briefing", qtd: 1, valor: 0, pagamento: "pendente", ativa: true, favorita: false },
      campos: [
        { nome: "campanha", rotulo: "Campanha", obrigatorio: true, inteira: true },
        { nome: "cliente", rotulo: "Cliente", lista: dados.marcas.map((m) => m.nome) },
        { nome: "tipo", rotulo: "Tipo", tipo: "select", opcoes: [["Conteúdo", "Conteúdo"], ["Publicidade", "Publicidade"]] },
        { nome: "status", rotulo: "Status", tipo: "select", opcoes: FUNIL.map((s) => [s, s]) },
        { nome: "qtd", rotulo: "Quantidade de vídeos", tipo: "number" },
        { nome: "valor", rotulo: "Valor (R$)", tipo: "number", passo: "0.01" },
        { nome: "prazo", rotulo: "Prazo", tipo: "date", dica: "Aparece sozinho no calendário." },
        { nome: "pagamento", rotulo: "Pagamento", tipo: "select", opcoes: [["pendente", "Pendente"], ["pago", "Pago"]] },
        { nome: "ativa", rotulo: "Campanha ativa", tipo: "checkbox" },
        { nome: "favorita", rotulo: "Destacar com estrela", tipo: "checkbox" }
      ],
      aoSalvar: async (obj) => {
        const linha = await gravar("campanhas", obj, c && c.id);
        if (!linha) return false;
        if (c) trocarNaLista(dados.campanhas, linha); else dados.campanhas.unshift(linha);
        recado("Campanha salva");
        mostrarAba();
        return true;
      },
      aoApagar: c ? async () => {
        if (!(await apagar("campanhas", c.id))) return false;
        dados.campanhas = dados.campanhas.filter((x) => x.id !== c.id);
        recado("Campanha apagada");
        mostrarAba();
        return true;
      } : null
    });
  }

  /* =================================================================
     ABA 5: CHECKLIST DO PORTFÓLIO (conteúdo do js/biblioteca.js)
     ================================================================= */
  const estadoCheck = { sub: "checklist" };
  const SUBS = [["checklist", "Checklist do portfólio"], ["referencias", "Referências de vídeo"], ["roteiros", "Roteiros"], ["nichos", "Ideias por nicho"], ["revisar", "Revisar meu roteiro"]];

  async function marcar(chave, ligado) {
    try {
      const consulta = ligado
        ? banco.from("marcados").upsert({ chave, marcado: true, atualizado_em: new Date().toISOString() })
        : banco.from("marcados").delete().eq("chave", chave);
      const { error } = await consulta;
      if (error) throw error;
      if (ligado) marcados.add(chave); else marcados.delete(chave);
      return true;
    } catch (erro) {
      recado(traduzErro(erro, "marcados"), true);
      return false;
    }
  }
  const barra = (feitos, total) => `<div class="progresso"><i style="width:${total ? Math.round((feitos / total) * 100) : 0}%"></i></div>`;

  function renderChecklist(area) {
    const B = window.Biblioteca;
    if (!B) {
      area.innerHTML = `<div class="cartao"><p class="frase-vazia">Não encontrei o arquivo js/biblioteca.js, que traz o conteúdo do checklist. Confira se ele está na pasta js do projeto.</p></div>`;
      return;
    }
    area.innerHTML = `<div class="sub-abas" role="group" aria-label="Partes do checklist">
        ${SUBS.map(([v, t]) => `<button type="button" data-sub="${v}" aria-pressed="${estadoCheck.sub === v}">${t}</button>`).join("")}
      </div><div id="sub-area" class="area"></div>`;
    $$("[data-sub]", area).forEach((b) => b.addEventListener("click", () => { estadoCheck.sub = b.dataset.sub; renderChecklist(area); }));
    const sub = $("#sub-area");
    try {
      ({ checklist: subChecklist, referencias: subReferencias, roteiros: subRoteiros, nichos: subNichos, revisar: subRevisar })[estadoCheck.sub](sub, B);
    } catch (erro) {
      console.error(erro);
      sub.innerHTML = `<div class="cartao"><p class="frase-vazia">Esta parte não abriu direito porque o arquivo da biblioteca veio diferente do esperado.</p></div>`;
    }
  }

  function subChecklist(sub, B) {
    const secoes = B.CHECKLIST || [];
    const chave = (s, i) => `checklist:${s.id}:${i}`;
    const total = secoes.reduce((t, s) => t + (s.itens || []).length, 0);
    const feitosTotal = secoes.reduce((t, s) => t + (s.itens || []).filter((_, i) => marcados.has(chave(s, i))).length, 0);
    sub.innerHTML = `
      <section class="cartao">
        <div class="cartao-topo"><h2>Quanto do portfólio já está pronto</h2><span class="dica">${feitosTotal} de ${total} itens</span></div>
        ${barra(feitosTotal, total)}
      </section>
      ${secoes.map((s) => {
        const itens = s.itens || [];
        const feitos = itens.filter((_, i) => marcados.has(chave(s, i))).length;
        return `<details class="bloco" data-secao="${esc(s.id)}">
          <summary><span class="emoji">${esc(s.emoji)}</span><strong>${esc(s.nome)}</strong><span class="contagem">${feitos} de ${itens.length}${barra(feitos, itens.length)}</span><small>${esc(s.resumo)}</small></summary>
          <div class="bloco-corpo">
            ${s.porque ? `<p class="porque"><b>Por que:</b> ${htmlSeguro(s.porque)}</p>` : ""}
            <ul class="itens">${itens.map((it, i) => `<li><label><input type="checkbox" data-chave="${esc(chave(s, i))}" ${marcados.has(chave(s, i)) ? "checked" : ""}><span class="t">${htmlSeguro(it.t)}</span><span class="d">${htmlSeguro(it.d)}</span></label></li>`).join("")}</ul>
          </div></details>`;
      }).join("")}`;
    sub.onchange = async (e) => {
      const caixa = e.target.closest("input[data-chave]");
      if (!caixa) return;
      caixa.disabled = true;
      const ok = await marcar(caixa.dataset.chave, caixa.checked);
      if (!ok) caixa.checked = !caixa.checked;
      caixa.disabled = false;
      /* atualiza as barrinhas sem fechar as seções abertas */
      const abertas = $$("details[open]", sub).map((d) => d.dataset.secao);
      subChecklist(sub, B);
      abertas.forEach((id) => { const d = sub.querySelector(`details[data-secao="${CSS.escape(id)}"]`); if (d) d.open = true; });
    };
  }

  function subReferencias(sub, B) {
    const refs = B.REFERENCIAS || [];
    const audiencia = (v) => ((B.AUDIENCIAS || []).find((a) => a.v === v) || { t: v || "" }).t;
    sub.innerHTML = `<div class="grade-refs">${refs.map((r, i) => `
      <button type="button" class="ref" data-ref="${i}">
        <span class="ref-capa c-${esc(r.cor)}" aria-hidden="true">${esc(r.emoji)}</span>
        <strong>${esc(r.titulo)}</strong>
        <small>${esc(r.estilo)} · ${esc(r.duracao)}</small>
        <small>${esc(r.marca)}</small>
      </button>`).join("")}</div>`;
    sub.querySelectorAll("[data-ref]").forEach((b) => b.addEventListener("click", () => {
      const r = refs[Number(b.dataset.ref)];
      abrirModal(`${r.emoji || ""} ${r.titulo}`, `<div class="ficha">
        <div class="chips-info"><span class="pilula">${esc(r.estilo)}</span><span class="pilula">${esc(audiencia(r.audiencia))}</span><span class="pilula">${esc(r.duracao)}</span><span class="pilula">${esc(r.marca)}</span></div>
        <h3>O gancho</h3><p class="gancho">${htmlSeguro(r.gancho)}</p>
        <h3>Por que funciona</h3><p>${htmlSeguro(r.porque)}</p>
        <h3>O diferencial</h3><p>${htmlSeguro(r.diferencial)}</p>
        <h3>O erro comum</h3><p>${htmlSeguro(r.erro)}</p>
        <h3>O roteiro</h3>
        <ol class="passos">${(r.roteiro || []).map((p) => `<li><span>${esc(p.t)}</span><div>${htmlSeguro(p.o)}</div></li>`).join("")}</ol>
        ${r.youtube ? `<div class="form-acoes"><a class="botao botao-principal" href="${esc(r.youtube)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-play"/></svg>Assistir</a></div>` : ""}
      </div>`, true);
    }));
  }

  function subRoteiros(sub, B) {
    sub.innerHTML = (B.TIPOS || []).map((t) => `
      <details class="bloco">
        <summary><span class="emoji">${esc(t.emoji)}</span><strong>${esc(t.nome)}</strong><span class="contagem">${esc(t.duracao)}</span><small>${htmlSeguro(t.porque)}</small></summary>
        <div class="bloco-corpo">
          <p class="porque"><b>Quando usar:</b> ${htmlSeguro(t.porque)}</p>
          <ol class="passos">${(t.beats || []).map((p) => `<li><span>${esc(p.t)}</span><div>${htmlSeguro(p.o)}</div></li>`).join("")}</ol>
          ${(t.erros || []).length ? `<div><h3 style="font-size:.8rem;margin-bottom:6px">Erros comuns</h3><ul class="lista-simples">${t.erros.map((e) => `<li>${htmlSeguro(e)}</li>`).join("")}</ul></div>` : ""}
        </div>
      </details>`).join("");
  }

  function subNichos(sub, B) {
    const comoUsar = B.COMO_USAR || [];
    sub.innerHTML = `
      ${comoUsar.length ? `<section class="cartao"><h2>Como usar os ganchos</h2><ul class="lista-simples">${comoUsar.map((c) => `<li>${htmlSeguro(c)}</li>`).join("")}</ul></section>` : ""}
      <div class="grade-nichos">${(B.NICHOS || []).map((n) => `
        <section class="cartao">
          <h2>${esc(n.emoji)} ${esc(n.nome)}</h2>
          ${(n.ideias || []).map((i) => `<div class="ideia"><strong>${htmlSeguro(i.t)}</strong><em>${htmlSeguro(i.gancho)}</em></div>`).join("")}
        </section>`).join("")}</div>`;
  }

  function subRevisar(sub, B) {
    const blocos = B.REVISAO || [];
    const chave = (bi, ii) => `revisao:${bi}:${ii}`;
    let texto = "";
    try { texto = localStorage.getItem("painel-roteiro") || ""; } catch (erro) { texto = ""; }
    const total = blocos.reduce((t, b) => t + (b.itens || []).length, 0);
    const feitos = blocos.reduce((t, b, bi) => t + (b.itens || []).filter((_, ii) => marcados.has(chave(bi, ii))).length, 0);
    sub.innerHTML = `
      <section class="cartao">
        <div class="cartao-topo"><h2>Cole aqui o seu roteiro</h2><span class="dica">fica guardado só neste navegador</span></div>
        <textarea class="campo-roteiro" id="campo-roteiro" placeholder="Cole o roteiro aqui e vá conferindo os itens abaixo.">${esc(texto)}</textarea>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Conferência</h2><span class="dica">${feitos} de ${total} itens</span><button type="button" class="botao botao-leve" id="limpar-revisao">Limpar conferência</button></div>
        ${barra(feitos, total)}
      </section>
      ${blocos.map((b, bi) => `
        <details class="bloco" open>
          <summary><span class="emoji">${esc(b.emoji)}</span><strong>${esc(b.bloco)}</strong><span class="contagem">${(b.itens || []).filter((_, ii) => marcados.has(chave(bi, ii))).length} de ${(b.itens || []).length}</span></summary>
          <div class="bloco-corpo"><ul class="itens">${(b.itens || []).map((it, ii) => `<li><label><input type="checkbox" data-chave="${chave(bi, ii)}" ${marcados.has(chave(bi, ii)) ? "checked" : ""}><span class="t">${htmlSeguro(it.t)}</span><span class="d">${htmlSeguro(it.d)}</span></label></li>`).join("")}</ul></div>
        </details>`).join("")}`;
    $("#campo-roteiro").addEventListener("input", (e) => { try { localStorage.setItem("painel-roteiro", e.target.value); } catch (erro) { /* navegador sem armazenamento */ } });
    $("#limpar-revisao").addEventListener("click", async () => {
      const chaves = Array.from(marcados).filter((c) => c.startsWith("revisao:"));
      if (!chaves.length) return;
      try {
        const { error } = await banco.from("marcados").delete().in("chave", chaves);
        if (error) throw error;
        chaves.forEach((c) => marcados.delete(c));
        subRevisar(sub, B);
      } catch (erro) { recado(traduzErro(erro, "marcados"), true); }
    });
    sub.onchange = async (e) => {
      const caixa = e.target.closest("input[data-chave]");
      if (!caixa) return;
      caixa.disabled = true;
      const ok = await marcar(caixa.dataset.chave, caixa.checked);
      if (!ok) caixa.checked = !caixa.checked;
      subRevisar(sub, B);
    };
  }

  /* =================================================================
     ABA 6: ROTEIROS (transcrição de vídeos pela Supadata + biblioteca)
     A chave da Supadata fica na tabela "configuracoes" (nunca no código).
     ================================================================= */
  const SUPADATA = "https://api.supadata.ai/v1";
  const CHAVE_SUPADATA = "supadata_api_key";
  const estadoRot = { busca: "", filtro: "todos", deQuem: "outra", link: "", aviso: null, saldo: null, saldoErro: "", saldoPedido: false };
  const transcrevendo = new Set();
  const NOME_FONTE = { instagram: "📸 Instagram", tiktok: "🎵 TikTok", youtube: "▶️ YouTube", manual: "✍️ Escrito na mão" };
  const EMOJI_FONTE = { instagram: "📸", tiktok: "🎵", youtube: "▶️", manual: "✍️" };
  const chaveSupadata = () => String(dados.config[CHAVE_SUPADATA] || "").trim();

  /* ---- links ---- */
  function limparLink(bruto) {
    const texto = String(bruto || "").trim();
    if (!/^https?:\/\//i.test(texto)) return null;
    let u;
    try { u = new URL(texto); } catch (erro) { return null; }
    u.hash = "";
    Array.from(u.searchParams.keys()).forEach((k) => {
      if (/^utm_/i.test(k) || ["igsh", "igshid", "si", "feature", "is_from_webapp", "sender_device", "_r", "_t", "share_app_id"].includes(k)) u.searchParams.delete(k);
    });
    u.pathname = u.pathname.replace(/\/reels\//i, "/reel/");
    return u.toString().replace(/\?$/, "");
  }
  function fonteDoLink(link) {
    const host = (() => { try { return new URL(link).hostname.toLowerCase(); } catch (erro) { return ""; } })();
    if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
    if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return "youtube";
    return "";
  }
  function perfilDoLink(link, fonte) {
    try {
      const partes = new URL(link).pathname.split("/").filter(Boolean);
      if (fonte === "instagram" && partes.length >= 3 && ["reel", "p", "tv"].includes(partes[1])) return "@" + partes[0];
      if (fonte === "tiktok" && partes[0] && partes[0].startsWith("@")) return partes[0];
    } catch (erro) { /* sem perfil no link */ }
    return "";
  }
  function idDoVideo(fonte, link) {
    const s = String(link || "");
    if (fonte === "instagram") return (s.match(/instagram\.com\/(?:[^/]+\/)?(?:reel|p|tv)\/([\w-]+)/i) || [])[1] || "";
    if (fonte === "youtube") return idYT(s);
    if (fonte === "tiktok") return (s.match(/\/video\/(\d+)/) || [])[1] || "";
    return "";
  }
  function linkEmbed(fonte, id) {
    if (fonte === "instagram") return `https://www.instagram.com/reel/${id}/embed`;
    if (fonte === "youtube") return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
    if (fonte === "tiktok") return `https://www.tiktok.com/embed/v2/${id}`;
    return "";
  }

  /* ---- Supadata ---- */
  async function pedirSupadata(caminho, chave, parametros) {
    const url = SUPADATA + caminho + (parametros ? "?" + new URLSearchParams(parametros).toString() : "");
    const resposta = await fetch(url, { headers: { "x-api-key": chave } });
    let corpo = null;
    try { corpo = await resposta.json(); } catch (erro) { corpo = null; }
    return { status: resposta.status, corpo };
  }
  function erroSupadata(status, corpo) {
    const codigo = String((corpo && (corpo.error || corpo.code)) || "").toLowerCase();
    const detalhe = String((corpo && (corpo.details || corpo.message)) || "").toLowerCase();
    if (codigo === "limit-exceeded" || status === 429) {
      if (detalhe.includes("plan usage")) return "Acabaram os créditos do mês na Supadata. Eles voltam no começo do próximo ciclo, ou dá para trocar de plano no site deles.";
      if (detalhe.includes("request rate") || detalhe.includes("rate limit")) return "Foram muitos pedidos seguidos. Espere 1 minuto e tente de novo.";
      return "A Supadata pediu uma pausa. Espere 1 minuto e tente de novo.";
    }
    if (status === 401 || status === 403 || codigo.includes("unauthorized") || codigo.includes("api-key") || codigo.includes("forbidden"))
      return "A chave da Supadata não foi aceita. Confira se copiou a chave inteira e salve de novo.";
    if (status === 206 || codigo === "transcript-unavailable") return "VAZIO";
    if (status === 404 || codigo === "not-found") return "Não encontrei esse vídeo. Confira se o link abre e se o perfil é público.";
    if (status === 400 || codigo === "invalid-request") return "Esse link não foi aceito. Confira se é o link de um vídeo do Instagram, TikTok ou YouTube.";
    return "A transcrição não deu certo agora. Tente de novo em alguns minutos.";
  }
  function textoDoResultado(c) {
    const conteudo = c && c.content;
    if (typeof conteudo === "string") return { texto: conteudo.trim(), segmentos: null, lang: c.lang };
    if (Array.isArray(conteudo)) return { texto: conteudo.map((s) => (s && s.text) || "").join(" ").replace(/\s+/g, " ").trim(), segmentos: conteudo, lang: c.lang };
    return { texto: "", segmentos: null, lang: c && c.lang };
  }
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const MSG_VAZIO = "Não achei fala nesse vídeo. Costuma ser reel só com música ou só com texto na tela.";

  async function atualizarSaldo() {
    const chave = chaveSupadata();
    estadoRot.saldo = null; estadoRot.saldoErro = "";
    if (!chave) { mostrarSaldo(); return; }
    try {
      const { status, corpo } = await pedirSupadata("/me", chave);
      if (status === 200 && corpo) estadoRot.saldo = corpo;
      else estadoRot.saldoErro = erroSupadata(status, corpo);
    } catch (erro) { estadoRot.saldoErro = "Não consegui ver o saldo agora."; }
    mostrarSaldo();
  }
  function textoSaldo() {
    if (!chaveSupadata()) return "Sem chave salva ainda.";
    if (estadoRot.saldoErro) return "⚠️ " + estadoRot.saldoErro;
    const s = estadoRot.saldo;
    if (!s) return "Conferindo o saldo...";
    const usados = numero(s.usedCredits), maximo = numero(s.maxCredits);
    return `📊 ${usados} de ${maximo} créditos usados este mês${s.plan ? ` (plano ${esc(s.plan)})` : ""}`;
  }
  function mostrarSaldo() { const el = $("#rot-saldo"); if (el) el.innerHTML = textoSaldo(); }

  /* ---- aviso do topo (andamento e erros) ---- */
  function avisoRot(tipo, html, acao) {
    estadoRot.aviso = tipo ? { tipo, html, acao } : null;
    desenharAvisoRot();
  }
  function desenharAvisoRot() {
    const el = $("#rot-aviso");
    if (!el) return;
    const a = estadoRot.aviso;
    if (!a) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.className = "rot-aviso " + a.tipo;
    el.innerHTML = `<span>${a.html}</span>${a.acao ? `<button type="button" class="botao botao-leve" id="rot-aviso-acao">${esc(a.acao.texto)}</button>` : ""}`;
    if (a.acao) $("#rot-aviso-acao").addEventListener("click", a.acao.fazer);
  }
  const SEM_CHAVE = `🔑 Para transcrever, falta a chave da Supadata. É grátis: crie uma conta em <a href="https://supadata.ai" target="_blank" rel="noopener">supadata.ai</a> (100 créditos por mês, sem cartão), copie a API key no painel deles e cole no campo "Chave da Supadata" aqui embaixo.`;

  /* ---- transcrever ---- */
  async function transcrever(linkBruto, deQuem, existente) {
    const link = limparLink(linkBruto);
    if (!link) { avisoRot("erro", "🤔 Esse link não parece certo. Cole o link completo do vídeo, começando com https://"); return; }
    const fonte = fonteDoLink(link);
    if (!fonte) { avisoRot("erro", "🤔 Esse link não é do Instagram, TikTok ou YouTube. Para outro tipo de vídeo, use \"Escrever na mão\"."); return; }
    const chave = chaveSupadata();
    if (!chave) { avisoRot("erro", SEM_CHAVE); const campo = $("#rot-chave"); if (campo) campo.focus(); return; }
    let linha = existente || null;
    if (!linha) {
      const repetido = dados.roteiros.find((r) => r.url === link);
      if (repetido) {
        if (!confirm("Esse vídeo já está na sua biblioteca. Quer transcrever de novo?")) { avisoRot("info", "👍 Ok, deixei como estava. Ele já está na biblioteca."); return; }
        linha = repetido;
      }
    }
    linha = linha
      ? await gravar("roteiros", { status: "processando", erro: null, url: link, fonte }, linha.id)
      : await gravar("roteiros", { fonte, url: link, perfil: perfilDoLink(link, fonte), de_quem: deQuem === "minha" ? "minha" : "outra", status: "processando" });
    if (!linha) { avisoRot("erro", "😕 Não consegui criar o roteiro na biblioteca porque a tabela de roteiros não respondeu. Clique em Copiar o SQL, cole no SQL Editor do Supabase, clique em Run e tente de novo.", { texto: "📋 Copiar o SQL", fazer: copiarSQL }); return; }
    trocarNaLista(dados.roteiros, linha);
    ordenarRoteiros();
    transcrevendo.add(linha.id);
    estadoRot.link = "";
    redesenharRoteiros();

    const inicio = Date.now();
    const andamento = () => {
      const s = Math.round((Date.now() - inicio) / 1000);
      const tempo = s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${dois(s % 60)}s`;
      avisoRot("andamento", `🎧 Ouvindo o vídeo… ${tempo}. Costuma levar de 3 a 4 minutos, pode deixar a aba aberta.`);
    };
    andamento();
    const relogio = setInterval(andamento, 5000);

    let resultado = null, mensagem = "";
    try {
      const primeiro = await pedirSupadata("/transcript", chave, { url: link, mode: "auto", text: "true", lang: "pt" });
      if (primeiro.status === 200) resultado = primeiro.corpo;
      else if (primeiro.status === 202 && primeiro.corpo && primeiro.corpo.jobId) {
        const limite = Date.now() + 6 * 60 * 1000;
        while (!resultado && !mensagem) {
          if (Date.now() > limite) { mensagem = "Demorou mais de 6 minutos e eu desisti. Tente de novo mais tarde, vídeos longos às vezes demoram."; break; }
          await esperar(5000);
          const job = await pedirSupadata("/transcript/" + encodeURIComponent(primeiro.corpo.jobId), chave);
          const st = job.corpo && String(job.corpo.status || "").toLowerCase();
          if (job.status !== 200 && job.status !== 202) mensagem = erroSupadata(job.status, job.corpo);
          else if (st === "completed") resultado = job.corpo.result || job.corpo;
          else if (st === "failed") mensagem = erroSupadata(job.status, job.corpo && job.corpo.error ? (typeof job.corpo.error === "object" ? job.corpo.error : job.corpo) : job.corpo);
        }
      } else mensagem = erroSupadata(primeiro.status, primeiro.corpo);
    } catch (erro) {
      mensagem = "Não consegui falar com a Supadata. Confira a internet e tente de novo.";
    }
    clearInterval(relogio);
    transcrevendo.delete(linha.id);

    let final;
    const { texto, segmentos, lang } = resultado ? textoDoResultado(resultado) : { texto: "" };
    if (resultado && texto && lang !== "none") {
      final = await gravar("roteiros", { transcricao: texto, segmentos, status: "pronto", erro: null }, linha.id);
      if (final) trocarNaLista(dados.roteiros, final);
      avisoRot("ok", "✅ Pronto. Revisa, dá um nome e salva.");
      redesenharRoteiros();
      atualizarSaldo();
      if (final) editarRoteiro(final, "✅ Pronto. Revisa, dá um nome e salva.");
      return;
    }
    const vazio = (resultado && (!texto || lang === "none")) || mensagem === "VAZIO";
    const motivo = vazio ? MSG_VAZIO : mensagem;
    final = await gravar("roteiros", { status: "falhou", erro: motivo }, linha.id);
    if (final) trocarNaLista(dados.roteiros, final);
    redesenharRoteiros();
    atualizarSaldo();
    if (vazio) avisoRot("erro", "🎶 " + MSG_VAZIO, { texto: "📝 Guardar assim mesmo", fazer: () => editarRoteiro(final || linha, "📝 Escreva aqui o texto do vídeo, se quiser.") });
    else avisoRot("erro", "😕 " + esc(motivo));
  }

  /* ---- biblioteca ---- */
  function ordenarRoteiros() { dados.roteiros.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))); }
  function tagsDe(r) { return Array.isArray(r.tags) ? r.tags.filter(Boolean) : []; }
  function roteirosFiltrados() {
    const b = estadoRot.busca.toLowerCase().trim();
    return dados.roteiros.filter((r) => {
      if (estadoRot.filtro === "minha" && r.de_quem !== "minha") return false;
      if (estadoRot.filtro === "outra" && r.de_quem === "minha") return false;
      if (estadoRot.filtro.startsWith("tag:") && !tagsDe(r).includes(estadoRot.filtro.slice(4))) return false;
      if (!b) return true;
      return [r.transcricao, r.perfil, r.titulo, r.obs, r.legenda].some((c) => String(c || "").toLowerCase().includes(b));
    });
  }
  function cardRoteiro(r) {
    const fonte = NOME_FONTE[r.fonte] ? r.fonte : "manual";
    const id = idDoVideo(fonte, r.url);
    const podeVer = !!(r.url && id && fonte !== "manual");
    const rodando = transcrevendo.has(r.id);
    const data = r.postado_em ? dataBR(r.postado_em) : (r.created_at ? dataBR(String(r.created_at).slice(0, 10)) : "");
    const etiqueta = r.de_quem === "minha" ? `<span class="pilula p-minha">⭐ Meu</span>` : `<span class="pilula p-outra">👀 De outra</span>`;
    let situacao = "";
    if (r.status === "processando") situacao = `<p class="rot-status"><span class="rot-relogio" aria-hidden="true">⏳</span>${rodando ? "Transcrevendo agora..." : "Ficou pela metade. A transcrição foi interrompida."}</p>`;
    if (r.status === "falhou") situacao = `<p class="rot-status falhou">⚠️ ${esc(r.erro || "A transcrição não deu certo.")}</p>`;
    const acoes = [];
    if (r.status === "pronto" || r.transcricao) acoes.push(`<button type="button" class="botao botao-leve" data-acao="copiar">📋 Copiar transcrição</button>`);
    if (r.status === "falhou") acoes.push(`<button type="button" class="botao botao-leve" data-acao="editar">📂 Abrir mesmo assim</button>`);
    if ((r.status === "processando" && !rodando) || r.status === "falhou") acoes.push(`<button type="button" class="botao botao-leve" data-acao="tentar">🔁 Tentar de novo</button>`);
    if (r.status !== "falhou") acoes.push(`<button type="button" class="botao botao-leve" data-acao="editar">✏️ Editar</button>`);
    acoes.push(`<button type="button" class="botao botao-leve" data-acao="apagar">🗑️ Apagar</button>`);
    return `<article class="rot-card" data-id="${esc(r.id)}">
      <div class="rot-capa f-${fonte}">
        ${fonte === "youtube" && id ? `<img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy">` : `<span class="rot-capa-emoji" aria-hidden="true">${EMOJI_FONTE[fonte]}</span>`}
        ${podeVer ? `<button type="button" class="rot-ver" data-acao="ver">▶ ver vídeo</button>` : ""}
      </div>
      <div class="rot-corpo">
        <h3>${r.titulo ? esc(r.titulo) : `<span class="dica">Sem título</span>`}</h3>
        <div class="rot-meta">
          ${r.perfil ? `<strong>${esc(r.perfil)}</strong>` : ""}
          ${etiqueta}
          <span class="pilula">${NOME_FONTE[fonte]}</span>
          ${tagsDe(r).map((t) => `<span class="pilula rot-tag">#${esc(t)}</span>`).join("")}
          ${data ? `<span class="dica">📅 ${data}</span>` : ""}
        </div>
        ${situacao}
        ${r.transcricao ? `<p class="rot-trecho">${esc(r.transcricao)}</p>` : (r.status === "pronto" ? `<p class="rot-trecho dica">Sem transcrição ainda.</p>` : "")}
        <div class="rot-acoes">${acoes.join("")}</div>
      </div>
    </article>`;
  }
  function desenharListaRoteiros() {
    const caixa = $("#rot-lista");
    if (!caixa) return;
    const lista = roteirosFiltrados();
    if (!lista.length) {
      caixa.innerHTML = `<p class="frase-vazia">${dados.roteiros.length ? "🔎 Nenhum roteiro com essa busca ou filtro." : "📭 Sua biblioteca ainda está vazia. Cole o link de um reel lá em cima e clique em Transcrever, ou escreva um roteiro na mão."}</p>`;
      return;
    }
    caixa.innerHTML = lista.map(cardRoteiro).join("");
  }
  function redesenharRoteiros() { if (abaAtual() === "roteiros") renderRoteiros($("#area")); }

  function editarRoteiro(r, aviso) {
    const novo = !r;
    formulario({
      titulo: novo ? "✍️ Escrever roteiro na mão" : "✏️ Editar roteiro",
      larga: true,
      aviso,
      valores: r ? { ...r, tags: tagsDe(r).join(", ") } : { de_quem: estadoRot.deQuem },
      campos: [
        { nome: "titulo", rotulo: "Título", inteira: true },
        { nome: "de_quem", rotulo: "De quem", tipo: "select", opcoes: [["outra", "👀 De outra pessoa"], ["minha", "⭐ Meu"]] },
        { nome: "perfil", rotulo: "Perfil", dica: "Ex: @nomedaperfil" },
        { nome: "url", rotulo: "Link do vídeo", tipo: "url", inteira: true },
        { nome: "postado_em", rotulo: "Data de postagem", tipo: "date" },
        { nome: "tags", rotulo: "Tags", dica: "Separe por vírgula. Ex: gancho, skincare, unboxing" },
        { nome: "legenda", rotulo: "Legenda do post", tipo: "textarea" },
        { nome: "transcricao", rotulo: "Transcrição", tipo: "textarea", alto: true },
        { nome: "obs", rotulo: "Minhas notas", tipo: "textarea" }
      ],
      aoSalvar: async (obj) => {
        const link = obj.url ? limparLink(obj.url) : "";
        if (obj.url && !link) { recado("O link precisa começar com https://", true); return false; }
        obj.url = link || "";
        obj.fonte = (link && fonteDoLink(link)) || "manual";
        obj.tags = String(obj.tags || "").split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
        if (obj.perfil && !obj.perfil.startsWith("@")) obj.perfil = "@" + obj.perfil.replace(/^@+/, "");
        if (!obj.perfil && link) obj.perfil = perfilDoLink(link, obj.fonte);
        obj.de_quem = obj.de_quem === "minha" ? "minha" : "outra";
        obj.status = "pronto";
        obj.erro = null;
        const linha = await gravar("roteiros", obj, r && r.id);
        if (!linha) return false;
        trocarNaLista(dados.roteiros, linha);
        ordenarRoteiros();
        recado("Roteiro salvo ✓");
        if (estadoRot.aviso && estadoRot.aviso.tipo !== "andamento") avisoRot(null);
        redesenharRoteiros();
        return true;
      },
      aoApagar: r ? async () => {
        if (!(await apagar("roteiros", r.id))) return false;
        dados.roteiros = dados.roteiros.filter((x) => x.id !== r.id);
        recado("Roteiro apagado");
        redesenharRoteiros();
        return true;
      } : null
    });
  }

  /* ---- estudar com o Claude: monta o prompt e copia ---- */
  async function estudarComClaude() {
    const outras = dados.roteiros.filter((r) => r.de_quem !== "minha" && String(r.transcricao || "").trim()).slice(0, 10);
    if (!outras.length) { avisoRot("erro", "🧠 Para estudar, guarde primeiro alguns roteiros marcados como \"De outra\" e com transcrição."); return; }
    const meusAssuntos = Array.from(new Set(dados.videos.map((v) => v.nicho).filter((n) => n && !/^destaques?$/i.test(n))));
    const blocos = outras.map((r, i) => {
      const texto = String(r.transcricao).trim();
      return `Roteiro ${i + 1}: ${r.perfil || "perfil não informado"} (${NOME_FONTE[r.fonte] ? NOME_FONTE[r.fonte].replace(/^\S+\s/, "") : "vídeo"})${r.titulo ? `, "${r.titulo}"` : ""}\n${texto.length > 3000 ? texto.slice(0, 3000) + "..." : texto}`;
    }).join("\n\n");
    const prompt = `Você é minha estrategista de conteúdo. Eu sou a Letícia Gabrielly, creator UGC (@leh.gsilva).
Meus assuntos: ${meusAssuntos.length ? meusAssuntos.join(", ") : "UGC para marcas de beleza, casa, maternidade e lifestyle"}.

Abaixo ${outras.length === 1 ? "está 1 roteiro recente" : `estão ${outras.length} roteiros recentes`} de outras creators, transcritos dos vídeos delas.

Quero que você:
1. Liste os assuntos que estão em alta nesses vídeos.
2. Mostre as expressões e frases que estão prendendo a atenção.
3. Identifique os padrões de gancho dos primeiros segundos e dê um exemplo real, tirado das transcrições, para cada padrão.
4. Escreva 5 roteiros novos para o MEU assunto, reaproveitando a estrutura desses vídeos (não o conteúdo). Cada roteiro com gancho, desenvolvimento e chamada final, separados em blocos de tempo.

Escreva tudo em português do Brasil, com linguagem natural de amiga que usou e indica, sem ficar robotizado e sem usar travessão.

ROTEIROS DE REFERÊNCIA

${blocos}`;
    try {
      await navigator.clipboard.writeText(prompt);
      avisoRot("ok", `🧠 Prompt copiado ✓ com ${plural(outras.length, "roteiro", "roteiros")} de outras creators. Agora abra o Claude, cole com Ctrl+V e envie.`, { texto: "Abrir o Claude", fazer: () => window.open("https://claude.ai/new", "_blank", "noopener") });
    } catch (erro) {
      abrirModal("🧠 Prompt para o Claude", `<p class="dica" style="margin-bottom:8px">Não consegui copiar sozinha. Selecione o texto abaixo, copie e cole no Claude.</p><textarea class="campo-roteiro" readonly style="min-height:320px">${esc(prompt)}</textarea>`, true);
    }
  }

  /* ---- a aba ---- */
  function renderRoteiros(area) {
    const chave = chaveSupadata();
    const todasTags = Array.from(new Set(dados.roteiros.flatMap(tagsDe))).sort((a, b) => a.localeCompare(b, "pt-BR"));
    if (estadoRot.filtro.startsWith("tag:") && !todasTags.includes(estadoRot.filtro.slice(4))) estadoRot.filtro = "todos";
    const chips = [["todos", "Todos"], ["minha", "⭐ Meus"], ["outra", "👀 De outras"]].concat(todasTags.map((t) => ["tag:" + t, "#" + t]));
    area.innerHTML = `
      <section class="cartao rot-topo">
        <p class="rot-frase">Cole o link de um reel e eu transcrevo. Serve pros seus e pros das outras, com etiqueta pra você separar.</p>
        <form class="rot-linha" id="rot-form" novalidate>
          <input class="campo-busca rot-link" id="rot-link" type="url" inputmode="url" placeholder="Cole aqui: instagram.com/reel/... · tiktok.com/... · youtube.com/..." value="${esc(estadoRot.link)}" aria-label="Link do vídeo">
          <select class="filtro" id="rot-dequem" aria-label="De quem é o vídeo">
            <option value="outra" ${estadoRot.deQuem !== "minha" ? "selected" : ""}>👀 De outra pessoa</option>
            <option value="minha" ${estadoRot.deQuem === "minha" ? "selected" : ""}>⭐ Meu</option>
          </select>
          <button type="submit" class="botao botao-principal">🎧 Transcrever</button>
          <button type="button" class="botao botao-leve" id="rot-manual">✍️ + Escrever na mão</button>
        </form>
        <div id="rot-aviso" class="rot-aviso" aria-live="polite" hidden></div>
        <div class="rot-config">
          <label for="rot-chave">🔑 Chave da Supadata</label>
          <input class="campo-busca" id="rot-chave" type="password" autocomplete="off" spellcheck="false" placeholder="${chave ? "salva, termina em ••••" + esc(chave.slice(-4)) : "cole aqui a sua API key"}">
          <button type="button" class="botao botao-leve" id="rot-salvar-chave">💾 Salvar</button>
          ${chave ? `<button type="button" class="botao botao-leve" id="rot-tirar-chave">Remover</button>` : ""}
          <span class="dica" id="rot-saldo">${textoSaldo()}</span>
        </div>
      </section>
      <section class="cartao">
        <div class="cartao-topo">
          <h2>📚 Biblioteca de roteiros <span class="dica">(${dados.roteiros.length})</span></h2>
          <button type="button" class="botao botao-principal" id="rot-claude">🧠 Estudar com o Claude</button>
        </div>
        <div class="ferramentas" style="margin-bottom:14px">
          <input class="campo-busca" id="rot-busca" style="flex:1 1 300px" type="search" placeholder="🔎 Buscar na transcrição, perfil, título ou notas" value="${esc(estadoRot.busca)}">
          <div class="chips" role="group" aria-label="Filtrar roteiros">
            ${chips.map(([v, t]) => `<button type="button" data-filtro="${esc(v)}" aria-pressed="${estadoRot.filtro === v}">${esc(t)}</button>`).join("")}
          </div>
        </div>
        <div id="rot-lista" class="rot-lista"></div>
      </section>`;

    desenharAvisoRot();
    desenharListaRoteiros();
    if (chave && !estadoRot.saldoPedido) { estadoRot.saldoPedido = true; atualizarSaldo(); }

    $("#rot-link").addEventListener("input", (e) => { estadoRot.link = e.target.value; });
    $("#rot-dequem").addEventListener("change", (e) => { estadoRot.deQuem = e.target.value; });
    $("#rot-form").addEventListener("submit", (e) => { e.preventDefault(); transcrever($("#rot-link").value, $("#rot-dequem").value); });
    $("#rot-manual").addEventListener("click", () => {
      const link = limparLink($("#rot-link").value);
      editarRoteiro(null);
      if (link) { const campo = $("#form-modal").elements.url; if (campo) campo.value = link; }
    });
    $("#rot-salvar-chave").addEventListener("click", async () => {
      const valor = $("#rot-chave").value.trim();
      if (!valor) { recado("Cole a chave no campo antes de salvar.", true); $("#rot-chave").focus(); return; }
      try {
        const { error } = await banco.from("configuracoes").upsert({ chave: CHAVE_SUPADATA, valor, updated_at: new Date().toISOString() });
        if (error) throw error;
        dados.config[CHAVE_SUPADATA] = valor;
        recado("Chave salva ✓");
        if (estadoRot.aviso && /Supadata/.test(estadoRot.aviso.html)) avisoRot(null);
        estadoRot.saldoPedido = true;
        renderRoteiros(area);
        atualizarSaldo();
      } catch (erro) { recado(traduzErro(erro, "configuracoes"), true); }
    });
    const tirar = $("#rot-tirar-chave");
    if (tirar) tirar.addEventListener("click", async () => {
      if (!confirm("Remover a chave da Supadata deste painel?")) return;
      try {
        const { error } = await banco.from("configuracoes").delete().eq("chave", CHAVE_SUPADATA);
        if (error) throw error;
        delete dados.config[CHAVE_SUPADATA];
        estadoRot.saldo = null; estadoRot.saldoErro = "";
        recado("Chave removida");
        renderRoteiros(area);
      } catch (erro) { recado(traduzErro(erro, "configuracoes"), true); }
    });
    $("#rot-claude").addEventListener("click", estudarComClaude);
    $("#rot-busca").addEventListener("input", (e) => { estadoRot.busca = e.target.value; desenharListaRoteiros(); });
    $$("[data-filtro]", area).forEach((b) => b.addEventListener("click", () => { estadoRot.filtro = b.dataset.filtro; renderRoteiros(area); }));
    $("#rot-lista").addEventListener("click", async (e) => {
      const botao = e.target.closest("[data-acao]");
      if (!botao) return;
      const card = botao.closest(".rot-card");
      const r = card && dados.roteiros.find((x) => String(x.id) === card.dataset.id);
      if (!r) return;
      const acao = botao.dataset.acao;
      if (acao === "ver") {
        const fonte = r.fonte, id = idDoVideo(fonte, r.url);
        const capa = card.querySelector(".rot-capa");
        capa.classList.add("tocando");
        capa.innerHTML = `<iframe src="${esc(linkEmbed(fonte, id))}" title="Vídeo ${esc(r.titulo || r.perfil || "")}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
      }
      if (acao === "copiar") {
        try { await navigator.clipboard.writeText(r.transcricao || ""); const antes = botao.textContent; botao.textContent = "copiado ✓"; setTimeout(() => { botao.textContent = antes; }, 1800); }
        catch (erro) { recado("Não consegui copiar. Abra em Editar e copie de lá.", true); }
      }
      if (acao === "editar") editarRoteiro(r);
      if (acao === "tentar") {
        if (!r.url) { editarRoteiro(r); return; }
        transcrever(r.url, r.de_quem, r);
      }
      if (acao === "apagar") {
        if (!confirm("Apagar este roteiro? Isso não tem volta.")) return;
        if (await apagar("roteiros", r.id)) { dados.roteiros = dados.roteiros.filter((x) => x.id !== r.id); recado("Roteiro apagado"); renderRoteiros(area); }
      }
    });
  }

  /* =================================================================
     ABA 7: VIRAIS (por que um conteúdo viralizou + adaptar a sua ideia)
     A análise é feita pelo Gemini do Google (uso gratuito). A chave fica
     na tabela "configuracoes" (nunca no código).
     ================================================================= */
  const CHAVE_GEMINI = "gemini_api_key";
  const MODELOS_GEMINI = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-flash-latest"];
  const CHAVE_GROQ = "groq_api_key";
  const MODELOS_GROQ = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"];
  const MODELOS_GROQ_BUSCA = ["groq/compound", "groq/compound-mini"];
  const estadoVir = { aviso: null, busca: "", form: {} };
  const analisando = new Set();
  const chaveGemini = () => String(dados.config[CHAVE_GEMINI] || "").trim();
  const chaveGroq = () => String(dados.config[CHAVE_GROQ] || "").trim();
  const temIA = () => !!(chaveGemini() || chaveGroq());
  const semTravessao = (t) => String(t == null ? "" : t).replace(new RegExp("\\s*[" + String.fromCharCode(8212, 8211) + "]\\s*", "g"), ", ");
  /* FORMATO DOS ROTEIROS DA LETÍCIA: tabela Tempo | Cena / ângulo | Fala | Texto na tela.
     Cena em primeira pessoa com as siglas dela, e toda fala marcada com o tipo. */
  const MODELO_BLOCOS_ROTEIRO = `[ { "tempo": "0 a 3s", "cena": "PP. Eu pego o pão quentinho da forma e mostro pra câmera", "tipo_fala": "FALADA PRA CÂMERA", "fala": "o que eu falo, palavra por palavra", "tom": "gesto e tom em detalhe, ex: levanto o dedo indicador na altura do rosto, falo mais baixo como quem conta um segredo", "texto_tela": "texto curto que aparece escrito no vídeo, ou vazio" } ]`;
  const REGRAS_ROTEIRO = `Regras do roteiro (muito importante):
- A coluna "cena" é escrita em PRIMEIRA PESSOA, como se a própria Letícia estivesse escrevendo ("eu pego o frasco", "eu me abaixo"), nunca "você faz".
- Toda cena começa com a sigla do ângulo: PP (primeiro plano), PM (plano médio), Detalhe, Plongée (câmera de cima para baixo) ou CP (contra plongée, câmera de baixo para cima).
- "tipo_fala" é sempre um destes três: "FALADA PRA CÂMERA" (olhando na lente), "NARRAÇÃO EM OFF" (voz por cima, sem falar na imagem) ou "SEM FALA".
- "tom" descreve gestos e tom em detalhe, nunca vago como "fala com urgência".
- Coloque naturalmente o toque dela nas cenas, sem tirar o protagonismo do assunto: verde, plantinha desfocada no canto, varal ao sol, mesa de madeira, som ambiente de passarinho, luz de fim de tarde.`;
  const ICONE_FALA = { "FALADA PRA CÂMERA": "🎤 FALADA PRA CÂMERA", "NARRAÇÃO EM OFF": "🎙️ NARRAÇÃO EM OFF", "SEM FALA": "🔇 SEM FALA" };
  const tipoFala = (b) => {
    const t = String(b.tipo_fala || "").toUpperCase();
    if (t.includes("SEM")) return ICONE_FALA["SEM FALA"];
    if (t.includes("OFF") || t.includes("NARRA")) return ICONE_FALA["NARRAÇÃO EM OFF"];
    if (t.includes("FALAD") || t.includes("CÂMERA") || t.includes("CAMERA")) return ICONE_FALA["FALADA PRA CÂMERA"];
    return b.fala ? "" : ICONE_FALA["SEM FALA"];
  };
  function tabelaRoteiro(blocos) {
    const t = (x) => esc(semTravessao(x));
    if (!Array.isArray(blocos) || !blocos.length) return `<p class="dica">Sem roteiro.</p>`;
    return `<div class="tabela-caixa"><table class="tabela-roteiro">
      <thead><tr><th>Tempo</th><th>Cena / ângulo</th><th>Fala</th><th>Texto na tela</th></tr></thead>
      <tbody>${blocos.map((b) => `<tr>
        <td><b>${t(b.tempo)}</b></td>
        <td>${t(b.cena)}</td>
        <td>${tipoFala(b) ? `<span class="pilula tipo-fala">${tipoFala(b)}</span><br>` : ""}${b.fala ? `"${t(b.fala)}"` : ""}${b.tom ? `<br><small class="dica">${t(b.tom)}</small>` : ""}</td>
        <td>${t(b.texto_tela)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }
  function textoBlocos(blocos) {
    const t = semTravessao;
    return (blocos || []).map((b) => [
      `[${t(b.tempo)}] ${t(b.cena)}`,
      tipoFala(b) ? `   ${tipoFala(b)}${b.fala ? `: "${t(b.fala)}"` : ""}` : (b.fala ? `   "${t(b.fala)}"` : ""),
      b.tom ? `   Gesto e tom: ${t(b.tom)}` : "",
      b.texto_tela ? `   Texto na tela: ${t(b.texto_tela)}` : ""
    ].filter(Boolean).join("\n")).join("\n");
  }
  const SEM_CHAVE_GEMINI =`✨ Para a análise, falta a chave grátis do Gemini (do Google). Entre em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> com a sua conta Google, clique em "Create API key", copie a chave e cole no campo "Chave do Gemini" aqui embaixo. Não pede cartão.`;

  /* números: aceita 1,2M · 120 mil · 15k · 3.400 */
  function paraNumero(texto) {
    let s = String(texto || "").toLowerCase().replace(/\s+/g, "").trim();
    if (!s) return null;
    let mult = 1;
    if (/(mi|m|milh(ão|ao|ões|oes))$/.test(s)) { mult = 1e6; s = s.replace(/(milh(ão|ao|ões|oes)|mi|m)$/, ""); }
    else if (/(mil|k)$/.test(s)) { mult = 1e3; s = s.replace(/(mil|k)$/, ""); }
    if (mult > 1) s = s.replace(",", ".");
    else s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  }
  function numeroCurto(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "";
    if (v >= 1e6) return (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
    if (v >= 1e3) return (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    return v.toLocaleString("pt-BR");
  }

  /* ---- Inteligência artificial: Gemini primeiro, Groq de reserva ----
     Cada modelo do Gemini tem o seu próprio limite grátis: quando um acaba,
     tenta o próximo. Se todos acabarem e houver chave do Groq (também grátis),
     o Groq responde no lugar. */
  const limiteDe = (status, motivo) => status === 429 || /quota|exhausted|rate/.test(motivo);
  async function chamarGemini(modelo, chave, corpoPedido) {
    let resposta, corpo = null;
    try {
      resposta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": chave }, body: JSON.stringify(corpoPedido)
      });
      try { corpo = await resposta.json(); } catch (erro) { corpo = null; }
    } catch (erro) { return { falha: "rede" }; }
    if (resposta.ok) {
      const candidato = corpo && corpo.candidates && corpo.candidates[0];
      const texto = candidato && candidato.content && (candidato.content.parts || []).map((p) => p.text || "").join("");
      return texto ? { texto, candidato } : { falha: "vazio" };
    }
    const status = resposta.status;
    const motivo = String((corpo && corpo.error && (corpo.error.status + " " + corpo.error.message)) || "").toLowerCase();
    if (status === 404 || motivo.includes("not found")) return { falha: "modelo" };
    if ((status === 400 && motivo.includes("api key")) || status === 401 || status === 403) return { falha: "chave" };
    if (limiteDe(status, motivo)) return { falha: "limite" };
    if (status === 400 && (motivo.includes("search") || motivo.includes("tool"))) return { falha: "sem-busca" };
    if (status >= 500) return { falha: "ocupado" };
    return { falha: "outro" };
  }
  async function chamarGroq(modelo, prompt, temperatura, pedirJSON) {
    let resposta, corpo = null;
    try {
      resposta = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + chaveGroq() },
        body: JSON.stringify(Object.assign({ model: modelo, messages: [{ role: "user", content: prompt }], temperature: temperatura == null ? 0.7 : temperatura },
          pedirJSON ? { response_format: { type: "json_object" } } : {}))
      });
      try { corpo = await resposta.json(); } catch (erro) { corpo = null; }
    } catch (erro) { return { falha: "rede" }; }
    if (resposta.ok) {
      const mensagem = corpo && corpo.choices && corpo.choices[0] && corpo.choices[0].message;
      return mensagem && mensagem.content ? { texto: mensagem.content, mensagem } : { falha: "vazio" };
    }
    const status = resposta.status;
    const motivo = String((corpo && corpo.error && corpo.error.message) || "").toLowerCase();
    if (status === 401 || status === 403 || motivo.includes("api key")) return { falha: "chave" };
    if (status === 404 || motivo.includes("does not exist") || motivo.includes("decommissioned")) return { falha: "modelo" };
    if (limiteDe(status, motivo) || status === 413) return { falha: "limite" };
    if (status >= 500) return { falha: "ocupado" };
    return { falha: "outro" };
  }
  function lerJSON(texto) {
    const limpo = String(texto || "").replace(/```json|```/g, "");
    const i = limpo.indexOf("{"), j = limpo.lastIndexOf("}");
    if (i < 0 || j <= i) throw new Error("A resposta veio bagunçada. Clique para tentar de novo.");
    try { return JSON.parse(limpo.slice(i, j + 1)); }
    catch (erro) { throw new Error("A resposta veio bagunçada. Clique para tentar de novo."); }
  }
  function erroDaIA(falhas) {
    if (falhas.includes("chave-gemini") && !chaveGroq()) return "A chave do Gemini não foi aceita. Confira se copiou a chave inteira e salve de novo na aba Virais.";
    if (falhas.includes("chave-groq")) return "A chave do Groq não foi aceita. Confira se copiou a chave inteira e salve de novo na aba Virais.";
    if (falhas.includes("limite")) return chaveGroq()
      ? "O Gemini e o Groq chegaram no limite grátis por agora. Espere alguns minutos e tente de novo (o limite do dia volta amanhã, sem pagar nada)."
      : "O Gemini chegou no limite grátis por agora. Você não precisa pagar: o limite volta sozinho (o do dia volta amanhã). Para não ficar esperando, salve também a chave grátis do Groq na aba 🔥 Virais e eu uso ele de reserva.";
    if (falhas.includes("rede")) return "Não consegui falar com a inteligência artificial. Confira a internet e tente de novo.";
    if (falhas.includes("ocupado")) return "O serviço está sobrecarregado agora. Tente de novo em 1 minuto.";
    return "Não deu certo agora. Tente de novo em instantes.";
  }

  /* pergunta e devolve JSON (Gemini, e se acabar o limite, Groq) */
  async function perguntarGemini(prompt, temperatura) {
    const falhas = [];
    if (chaveGemini()) {
      for (const modelo of MODELOS_GEMINI) {
        const r = await chamarGemini(modelo, chaveGemini(), { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: temperatura == null ? 0.7 : temperatura } });
        if (r.texto) return lerJSON(r.texto);
        if (r.falha === "chave") { falhas.push("chave-gemini"); break; }
        falhas.push(r.falha);
      }
    }
    if (chaveGroq()) {
      for (const modelo of MODELOS_GROQ) {
        const r = await chamarGroq(modelo, prompt, temperatura, true);
        if (r.texto) return lerJSON(r.texto);
        if (r.falha === "chave") { falhas.push("chave-groq"); break; }
        falhas.push(r.falha);
      }
    }
    throw new Error(erroDaIA(falhas));
  }

  /* transcrição pela Supadata (a mesma chave da aba Roteiros) */
  async function transcricaoSupadata(link, aoAndar) {
    const chave = chaveSupadata();
    const primeiro = await pedirSupadata("/transcript", chave, { url: link, mode: "auto", text: "true", lang: "pt" });
    let resultado = null;
    if (primeiro.status === 200) resultado = primeiro.corpo;
    else if (primeiro.status === 202 && primeiro.corpo && primeiro.corpo.jobId) {
      const limite = Date.now() + 6 * 60 * 1000;
      while (!resultado) {
        if (Date.now() > limite) throw new Error("A transcrição demorou mais de 6 minutos e eu desisti. Tente de novo mais tarde.");
        await esperar(5000);
        if (aoAndar) aoAndar();
        const job = await pedirSupadata("/transcript/" + encodeURIComponent(primeiro.corpo.jobId), chave);
        const st = job.corpo && String(job.corpo.status || "").toLowerCase();
        if (job.status !== 200 && job.status !== 202) { const m = erroSupadata(job.status, job.corpo); if (m === "VAZIO") return ""; throw new Error(m); }
        if (st === "completed") resultado = job.corpo.result || job.corpo;
        if (st === "failed") { const m = erroSupadata(job.status, job.corpo); if (m === "VAZIO") return ""; throw new Error(m); }
      }
    } else { const m = erroSupadata(primeiro.status, primeiro.corpo); if (m === "VAZIO") return ""; throw new Error(m); }
    const { texto, lang } = textoDoResultado(resultado);
    return lang === "none" ? "" : texto;
  }

  /* ---- prompts ---- */
  const meusNichos = () => Array.from(new Set(dados.videos.map((v) => v.nicho).filter((n) => n && !/^destaques?$/i.test(n))));
  function promptAnalise(v) {
    const numeros = [["visualizações", v.visualizacoes], ["curtidas", v.curtidas], ["comentários", v.comentarios], ["compartilhamentos", v.compartilhamentos], ["salvamentos", v.salvamentos]]
      .filter(([, n]) => n).map(([nome, n]) => `${nome}: ${Number(n).toLocaleString("pt-BR")}`).join(", ");
    return `Você é especialista em conteúdo viral para Reels, TikTok e Shorts, e ajuda creators UGC do Brasil.
Analise o vídeo abaixo, que teve ótimo desempenho, e explique por que ele viralizou.

Perfil: ${v.perfil || "não informado"}
Plataforma: ${NOME_FONTE[v.fonte] ? NOME_FONTE[v.fonte].replace(/^\S+\s/, "") : "não informada"}
Nicho: ${v.nicho || "não informado"}
Números: ${numeros || "não informados"}
Legenda do post: ${v.legenda || "não informada"}
O que chamou a atenção da creator: ${v.obs || "não informado"}

Transcrição do que é falado no vídeo:
"""
${String(v.transcricao || "").slice(0, 12000) || "sem fala (vídeo só com música ou texto na tela)"}
"""

Responda SOMENTE com um JSON válido, exatamente neste formato:
{
  "titulo_sugerido": "nome curto para guardar esta estrutura, até 6 palavras",
  "resumo": "uma ou duas frases sobre o vídeo",
  "porque_viralizou": "explicação clara em um parágrafo",
  "pontos_fortes": ["ponto forte 1", "ponto forte 2", "ponto forte 3"],
  "gancho": { "tipo": "nome do tipo de gancho, ex: curiosidade, identificação, quebra de expectativa, polêmica, promessa, pergunta, antes e depois", "frase": "a frase exata do gancho tirada da transcrição", "porque_funciona": "por que esse gancho prende" },
  "estrutura": [ { "tempo": "0 a 3s", "bloco": "nome do bloco", "o_que_acontece": "o que é dito ou mostrado", "objetivo": "para que serve esse bloco" } ],
  "gatilhos": ["gatilho mental usado"],
  "formato": "o formato do vídeo, ex: conversa olhando para a câmera, tutorial, antes e depois, encenação",
  "cta": "como o vídeo termina e qual a chamada",
  "como_replicar": ["dica prática para repetir essa estrutura"]
}

Regras: português do Brasil, linguagem simples de creator para creator, exemplos reais tirados da transcrição, sem inventar números, e nunca use travessão.`;
  }
  function promptAdaptar(v, ideia, produto, duracao) {
    const a = v.analise || {};
    return `Você é roteirista de conteúdo UGC e escreve para a creator Letícia Gabrielly (@leh.gsilva), que mora na roça em Minas Gerais e cria conteúdo real, com a naturalidade de uma amiga que usou, aprovou e indica.
Os nichos dela: ${meusNichos().join(", ") || "casa, beleza, maternidade, culinária"}.

Ela encontrou um vídeo que viralizou e quer usar A MESMA ESTRUTURA para a ideia dela. Reaproveite a estrutura, o tipo de gancho e o ritmo, mas NÃO copie o conteúdo nem as frases.

Estrutura que viralizou:
Tipo de gancho: ${a.gancho ? `${a.gancho.tipo}. Exemplo original: "${a.gancho.frase}"` : "não informado"}
Formato: ${a.formato || "não informado"}
Blocos: ${(a.estrutura || []).map((b) => `${b.tempo}: ${b.bloco} (${b.objetivo || b.o_que_acontece || ""})`).join(" | ") || "não informado"}
Pontos fortes: ${(a.pontos_fortes || []).join("; ")}
Gatilhos: ${(a.gatilhos || []).join(", ")}
Como termina: ${a.cta || "não informado"}

A ideia da Letícia: ${ideia}
${produto ? `Produto ou marca: ${produto}` : ""}
Duração desejada: ${duracao || "a mesma do vídeo original"}

Responda SOMENTE com um JSON válido, exatamente neste formato:
{
  "titulo": "nome curto do roteiro",
  "ganchos": ["opção de gancho 1", "opção de gancho 2", "opção de gancho 3"],
  "roteiro": ${MODELO_BLOCOS_ROTEIRO},
  "legenda": "legenda pronta para o post, com no máximo 3 hashtags",
  "cta": "a chamada final",
  "dicas_gravacao": ["dica prática para gravar"],
  "por_que_vai_funcionar": "explicação curta ligando à estrutura original"
}

${REGRAS_ROTEIRO}
Regras gerais: português do Brasil, fala natural e espontânea, nada robotizado, nada de linguagem de vendedor, e nunca use travessão.`;
  }

  /* ---- aviso ---- */
  function avisoVir(tipo, html, acao) { estadoVir.aviso = tipo ? { tipo, html, acao } : null; desenharAvisoVir(); }
  function desenharAvisoVir() {
    const el = $("#vir-aviso");
    if (!el) return;
    const a = estadoVir.aviso;
    if (!a) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.className = "rot-aviso " + a.tipo;
    el.innerHTML = `<span>${a.html}</span>${a.acao ? `<button type="button" class="botao botao-leve" id="vir-aviso-acao">${esc(a.acao.texto)}</button>` : ""}`;
    if (a.acao) $("#vir-aviso-acao").addEventListener("click", a.acao.fazer);
  }
  const redesenharVirais = () => { if (abaAtual() === "virais") renderVirais($("#area")); };

  /* ---- analisar ---- */
  async function analisarViral(dadosForm, existente) {
    if (!temIA()) { avisoVir("erro", SEM_CHAVE_GEMINI); const c = $("#vir-chave"); if (c) c.focus(); return; }
    const link = dadosForm.url ? limparLink(dadosForm.url) : "";
    if (dadosForm.url && !link) { avisoVir("erro", "🤔 Esse link não parece certo. Cole o link completo do vídeo, começando com https://"); return; }
    const fonte = (link && fonteDoLink(link)) || "manual";
    if (link && fonte === "manual") { avisoVir("erro", "🤔 Esse link não é do Instagram, TikTok ou YouTube. Cole o que é falado no campo de transcrição e deixe o link vazio."); return; }
    let transcricao = String(dadosForm.transcricao || "").trim();
    if (!transcricao && !link) { avisoVir("erro", "📝 Cole o link do vídeo ou escreva o que é falado nele, para eu ter o que analisar."); return; }
    if (!transcricao && link && !chaveSupadata()) { avisoVir("erro", "🔑 Para eu ouvir o vídeo pelo link, falta a chave da Supadata (fica na aba Roteiros). Ou cole o que é falado no campo de transcrição."); return; }

    const base = {
      url: link || "", fonte, perfil: dadosForm.perfil ? (dadosForm.perfil.startsWith("@") ? dadosForm.perfil : "@" + dadosForm.perfil) : (link ? perfilDoLink(link, fonte) : ""),
      nicho: dadosForm.nicho || "", legenda: dadosForm.legenda || "", obs: dadosForm.obs || "", transcricao,
      visualizacoes: paraNumero(dadosForm.visualizacoes), curtidas: paraNumero(dadosForm.curtidas), comentarios: paraNumero(dadosForm.comentarios),
      compartilhamentos: paraNumero(dadosForm.compartilhamentos), salvamentos: paraNumero(dadosForm.salvamentos), status: "analisando", erro: null
    };
    let linha = existente ? await gravar("virais", { status: "analisando", erro: null }, existente.id) : await gravar("virais", base);
    if (!linha) { avisoVir("erro", "😕 Não consegui guardar na biblioteca porque a tabela de virais ainda não existe no Supabase. Clique em Copiar o SQL, cole no SQL Editor do Supabase, clique em Run e tente de novo.", { texto: "📋 Copiar o SQL", fazer: copiarSQL }); return; }
    trocarNaLista(dados.virais, linha);
    dados.virais.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    analisando.add(linha.id);
    if (!existente) estadoVir.form = {};
    redesenharVirais();

    const inicio = Date.now();
    let etapa = "";
    const andar = () => { const s = Math.round((Date.now() - inicio) / 1000); avisoVir("andamento", `${etapa} ${s < 60 ? s + "s" : Math.floor(s / 60) + "min " + dois(s % 60) + "s"}. Pode deixar a aba aberta.`); };
    const relogio = setInterval(andar, 5000);
    try {
      if (!linha.transcricao && linha.url) {
        etapa = "🎧 Ouvindo o vídeo… (costuma levar de 1 a 4 minutos)";
        andar();
        const texto = await transcricaoSupadata(linha.url);
        const salvo = await gravar("virais", { transcricao: texto || "" }, linha.id);
        if (salvo) { linha = salvo; trocarNaLista(dados.virais, salvo); }
      }
      etapa = "🔍 Descobrindo por que viralizou…";
      andar();
      const analise = await perguntarGemini(promptAnalise(linha), 0.6);
      const final = await gravar("virais", { analise, titulo: linha.titulo || semTravessao(analise.titulo_sugerido || ""), status: "pronto", erro: null }, linha.id);
      clearInterval(relogio);
      analisando.delete(linha.id);
      if (final) { trocarNaLista(dados.virais, final); linha = final; }
      avisoVir("ok", "✅ Análise pronta e guardada na sua biblioteca de virais.");
      redesenharVirais();
      atualizarSaldo();
      verAnalise(linha);
    } catch (erro) {
      clearInterval(relogio);
      analisando.delete(linha.id);
      const motivo = erro.message || "A análise não deu certo agora.";
      const falhou = await gravar("virais", { status: "falhou", erro: motivo }, linha.id);
      if (falhou) trocarNaLista(dados.virais, falhou);
      avisoVir("erro", "😕 " + esc(motivo));
      redesenharVirais();
    }
  }

  /* ---- ver a análise ---- */
  function htmlAnalise(a) {
    const t = (x) => esc(semTravessao(x));
    const lista = (arr) => (Array.isArray(arr) && arr.length ? `<ul class="lista-simples">${arr.map((x) => `<li>${t(x)}</li>`).join("")}</ul>` : `<p class="dica">Sem informação.</p>`);
    return `<div class="ficha">
      ${a.resumo ? `<p>${t(a.resumo)}</p>` : ""}
      <h3>🚀 Por que viralizou</h3><p>${t(a.porque_viralizou)}</p>
      <h3>💪 Pontos fortes</h3>${lista(a.pontos_fortes)}
      <h3>🎣 O gancho</h3>
      ${a.gancho ? `<div class="chips-info"><span class="pilula p-outra">${t(a.gancho.tipo)}</span></div><p class="gancho" style="margin-top:6px">"${t(a.gancho.frase)}"</p><p style="margin-top:6px">${t(a.gancho.porque_funciona)}</p>` : `<p class="dica">Sem informação.</p>`}
      <h3>🧱 A estrutura</h3>
      ${Array.isArray(a.estrutura) && a.estrutura.length ? `<ol class="passos">${a.estrutura.map((b) => `<li><span>${t(b.tempo)}</span><div><b>${t(b.bloco)}</b>. ${t(b.o_que_acontece)}${b.objetivo ? `<br><small class="dica">Para que serve: ${t(b.objetivo)}</small>` : ""}</div></li>`).join("")}</ol>` : `<p class="dica">Sem informação.</p>`}
      <h3>🧠 Gatilhos</h3>${Array.isArray(a.gatilhos) && a.gatilhos.length ? `<div class="chips-info">${a.gatilhos.map((g) => `<span class="pilula">${t(g)}</span>`).join("")}</div>` : `<p class="dica">Sem informação.</p>`}
      <h3>🎬 Formato</h3><p>${t(a.formato)}</p>
      <h3>📣 Como termina</h3><p>${t(a.cta)}</p>
      <h3>🔁 Como repetir</h3>${lista(a.como_replicar)}
    </div>`;
  }
  function textoRoteiro(r) {
    const t = semTravessao;
    return [
      t(r.titulo),
      "",
      "Opções de gancho:",
      ...(r.ganchos || []).map((g, i) => `${i + 1}. ${t(g)}`),
      "",
      "Roteiro:",
      textoBlocos(r.roteiro),
      "",
      `Chamada final: ${t(r.cta)}`,
      "",
      `Legenda: ${t(r.legenda)}`
    ].join("\n");
  }
  function htmlAdaptacao(r) {
    const t = (x) => esc(semTravessao(x));
    return `<div class="ficha vir-resultado">
      <h3>✨ ${t(r.titulo)}</h3>
      <h3>🎣 3 opções de gancho</h3>
      <ol class="lista-simples">${(r.ganchos || []).map((g) => `<li>${t(g)}</li>`).join("")}</ol>
      <h3>🎬 Roteiro</h3>
      ${tabelaRoteiro(r.roteiro)}
      <h3>📣 Chamada final</h3><p>${t(r.cta)}</p>
      <h3>✍️ Legenda</h3><p>${t(r.legenda)}</p>
      ${(r.dicas_gravacao || []).length ? `<h3>🎥 Dicas para gravar</h3><ul class="lista-simples">${r.dicas_gravacao.map((d) => `<li>${t(d)}</li>`).join("")}</ul>` : ""}
      ${r.por_que_vai_funcionar ? `<h3>💡 Por que vai funcionar</h3><p>${t(r.por_que_vai_funcionar)}</p>` : ""}
    </div>`;
  }
  function verAnalise(v) {
    const adaptacoes = Array.isArray(v.adaptacoes) ? v.adaptacoes : [];
    abrirModal(`🔥 ${v.titulo || "Análise do viral"}`, `
      ${v.analise ? htmlAnalise(v.analise) : `<p class="frase-vazia">Ainda não tem análise. ${esc(v.erro || "")}</p>`}
      ${adaptacoes.length ? `<h3 class="vir-sub">📝 Suas adaptações (${adaptacoes.length})</h3>
        <ul class="vir-adaptacoes">${adaptacoes.slice().reverse().map((ad, i) => `<li><div><strong>${esc(semTravessao(ad.resultado && ad.resultado.titulo || "Roteiro"))}</strong><small class="dica">Ideia: ${esc(ad.ideia || "")}</small></div><button type="button" class="botao botao-leve" data-ver-adaptacao="${adaptacoes.length - 1 - i}">Abrir</button></li>`).join("")}</ul>` : ""}
      <div class="form-acoes"><button type="button" class="botao botao-principal" id="vir-adaptar-agora">✨ Adaptar minha ideia</button></div>`, true);
    $("#vir-adaptar-agora").addEventListener("click", () => adaptarIdeia(v));
    $$("[data-ver-adaptacao]").forEach((b) => b.addEventListener("click", () => mostrarAdaptacao(v, adaptacoes[Number(b.dataset.verAdaptacao)])));
  }

  /* ---- adaptar a ideia ---- */
  function adaptarIdeia(v) {
    if (!v.analise) { recado("Esse viral ainda não tem análise. Analise primeiro.", true); return; }
    const blocos = (v.analise.estrutura || []).map((b) => `${esc(b.tempo)} ${esc(b.bloco)}`).join(" · ");
    abrirModal(`✨ Adaptar minha ideia`, `
      <p class="dica" style="margin-bottom:10px">Estrutura de <b>${esc(v.titulo || "viral")}</b>${v.analise.gancho ? `, gancho de <b>${esc(semTravessao(v.analise.gancho.tipo))}</b>` : ""}${blocos ? `: ${blocos}` : ""}.</p>
      <form class="form-grade" id="vir-form-ideia" novalidate>
        <label class="inteira">Sua ideia *<textarea name="ideia" placeholder="Ex: mostrar como eu organizo a despensa da roça usando os potes da marca X"></textarea></label>
        <label>Produto ou marca<input name="produto" placeholder="opcional"></label>
        <label>Duração<select name="duracao"><option value="">Igual ao original</option><option>15 segundos</option><option>30 segundos</option><option>45 segundos</option><option>60 segundos</option></select></label>
        <div class="form-acoes inteira"><span class="espaco"></span><button type="button" class="botao botao-leve" id="vir-cancelar">Cancelar</button><button type="submit" class="botao botao-principal" id="vir-gerar">✨ Adaptar</button></div>
      </form>
      <div id="vir-andamento" class="rot-aviso andamento" hidden></div>`, true);
    $("#vir-cancelar").addEventListener("click", fecharModal);
    $("#vir-form-ideia").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const ideia = f.ideia.value.trim();
      if (!ideia) { recado("Escreva a sua ideia primeiro.", true); f.ideia.focus(); return; }
      if (!temIA()) { fecharModal(); avisoVir("erro", SEM_CHAVE_GEMINI); return; }
      const botao = $("#vir-gerar");
      botao.disabled = true;
      const caixa = $("#vir-andamento");
      const inicio = Date.now();
      const andar = () => { if (caixa) { caixa.hidden = false; caixa.innerHTML = `<span>✍️ Escrevendo o seu roteiro na mesma estrutura… ${Math.round((Date.now() - inicio) / 1000)}s</span>`; } };
      andar();
      const relogio = setInterval(andar, 1000);
      try {
        const resultado = await perguntarGemini(promptAdaptar(v, ideia, f.produto.value.trim(), f.duracao.value), 0.85);
        clearInterval(relogio);
        const nova = { data: new Date().toISOString(), ideia, produto: f.produto.value.trim(), resultado };
        const lista = (Array.isArray(v.adaptacoes) ? v.adaptacoes : []).concat([nova]).slice(-30);
        const salvo = await gravar("virais", { adaptacoes: lista }, v.id);
        if (salvo) { trocarNaLista(dados.virais, salvo); v = salvo; }
        mostrarAdaptacao(v, nova);
        redesenharVirais();
      } catch (erro) {
        clearInterval(relogio);
        botao.disabled = false;
        if (caixa) { caixa.className = "rot-aviso erro"; caixa.innerHTML = `<span>😕 ${esc(erro.message || "Não deu certo agora.")}</span>`; }
      }
    });
  }
  function mostrarAdaptacao(v, ad) {
    if (!ad || !ad.resultado) return;
    abrirModal(`✨ Seu roteiro`, `
      <p class="dica" style="margin-bottom:6px">Ideia: ${esc(ad.ideia)}. Na estrutura de <b>${esc(v.titulo || "viral")}</b>.</p>
      ${htmlAdaptacao(ad.resultado)}
      <div class="form-acoes">
        <button type="button" class="botao botao-leve" id="vir-outra">🔁 Fazer outra versão</button>
        <span class="espaco"></span>
        <button type="button" class="botao botao-leve" id="vir-copiar">📋 Copiar roteiro</button>
        <button type="button" class="botao botao-principal" id="vir-salvar-roteiro">💾 Salvar nos meus roteiros</button>
      </div>`, true);
    $("#vir-outra").addEventListener("click", () => adaptarIdeia(v));
    $("#vir-copiar").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(textoRoteiro(ad.resultado)); e.target.textContent = "copiado ✓"; }
      catch (erro) { recado("Não consegui copiar. Selecione o texto e copie.", true); }
    });
    $("#vir-salvar-roteiro").addEventListener("click", async (e) => {
      e.target.disabled = true;
      const linha = await gravar("roteiros", {
        fonte: "manual", url: "", perfil: "@leh.gsilva", de_quem: "minha", titulo: semTravessao(ad.resultado.titulo || ad.ideia).slice(0, 200),
        transcricao: textoRoteiro(ad.resultado), legenda: semTravessao(ad.resultado.legenda || ""), tags: ["adaptado", "viral"],
        obs: `Adaptado da estrutura de ${v.titulo || "um viral"}${v.perfil ? ` (${v.perfil})` : ""}. Ideia: ${ad.ideia}`, status: "pronto"
      });
      if (linha) { trocarNaLista(dados.roteiros, linha); ordenarRoteiros(); e.target.textContent = "salvo na aba Roteiros ✓"; }
      else e.target.disabled = false;
    });
  }

  /* ---- biblioteca ---- */
  function cardViral(v) {
    const fonte = NOME_FONTE[v.fonte] ? v.fonte : "manual";
    const id = idDoVideo(fonte, v.url);
    const a = v.analise || {};
    const rodando = analisando.has(v.id);
    const numeros = [["👀", v.visualizacoes], ["❤️", v.curtidas], ["💬", v.comentarios], ["🔁", v.compartilhamentos], ["🔖", v.salvamentos]].filter(([, n]) => numeroCurto(n)).map(([e, n]) => `<span class="pilula">${e} ${numeroCurto(n)}</span>`).join("");
    let situacao = "";
    if (v.status === "analisando") situacao = `<p class="rot-status"><span class="rot-relogio" aria-hidden="true">⏳</span>${rodando ? "Analisando agora..." : "Ficou pela metade. A análise foi interrompida."}</p>`;
    if (v.status === "falhou") situacao = `<p class="rot-status falhou">⚠️ ${esc(v.erro || "A análise não deu certo.")}</p>`;
    const acoes = [];
    if (v.analise) acoes.push(`<button type="button" class="botao botao-principal" data-acao="adaptar">✨ Adaptar minha ideia</button>`, `<button type="button" class="botao botao-leve" data-acao="ver-analise">📖 Ver análise</button>`);
    if ((v.status === "analisando" && !rodando) || v.status === "falhou") acoes.push(`<button type="button" class="botao botao-leve" data-acao="refazer">🔁 Tentar de novo</button>`);
    acoes.push(`<button type="button" class="botao botao-leve" data-acao="apagar">🗑️ Apagar</button>`);
    return `<article class="rot-card" data-id="${esc(v.id)}">
      <div class="rot-capa f-${fonte}">
        ${fonte === "youtube" && id ? `<img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy">` : `<span class="rot-capa-emoji" aria-hidden="true">🔥</span>`}
        ${v.url && id ? `<button type="button" class="rot-ver" data-acao="ver">▶ ver vídeo</button>` : ""}
      </div>
      <div class="rot-corpo">
        <h3>${v.titulo ? esc(v.titulo) : `<span class="dica">Sem título</span>`}</h3>
        <div class="rot-meta">
          ${v.perfil ? `<strong>${esc(v.perfil)}</strong>` : ""}
          <span class="pilula">${NOME_FONTE[fonte]}</span>
          ${v.nicho ? `<span class="pilula rot-tag">#${esc(v.nicho)}</span>` : ""}
          ${a.gancho && a.gancho.tipo ? `<span class="pilula p-outra">🎣 ${esc(semTravessao(a.gancho.tipo))}</span>` : ""}
          ${numeros}
        </div>
        ${situacao}
        ${a.porque_viralizou ? `<p class="rot-trecho">${esc(semTravessao(a.porque_viralizou))}</p>` : ""}
        ${Array.isArray(a.pontos_fortes) && a.pontos_fortes.length ? `<div class="rot-meta">${a.pontos_fortes.slice(0, 3).map((p) => `<span class="pilula vir-forte">💪 ${esc(semTravessao(p))}</span>`).join("")}</div>` : ""}
        ${Array.isArray(v.adaptacoes) && v.adaptacoes.length ? `<p class="dica">📝 ${plural(v.adaptacoes.length, "ideia adaptada", "ideias adaptadas")} com esta estrutura</p>` : ""}
        <div class="rot-acoes">${acoes.join("")}</div>
      </div>
    </article>`;
  }

  function renderVirais(area) {
    const f = estadoVir.form;
    const nichos = meusNichos();
    const lista = dados.virais.filter((v) => {
      const b = estadoVir.busca.toLowerCase().trim();
      if (!b) return true;
      const a = v.analise || {};
      return [v.titulo, v.perfil, v.nicho, v.transcricao, v.obs, a.porque_viralizou, a.gancho && a.gancho.tipo].some((c) => String(c || "").toLowerCase().includes(b));
    });
    const valor = (nome) => esc(f[nome] || "");
    area.innerHTML = `
      <section class="cartao rot-topo">
        <p class="rot-frase">Achou um conteúdo que bombou? Cole aqui que eu te explico por que viralizou e guardo a estrutura. Depois é só trazer a sua ideia que eu adapto do mesmo jeito.</p>
        <form class="form-grade vir-form" id="vir-form" novalidate>
          <label class="inteira">🔗 Link do vídeo<input name="url" type="url" inputmode="url" placeholder="instagram.com/reel/... · tiktok.com/... · youtube.com/..." value="${valor("url")}"></label>
          <label>👤 Perfil<input name="perfil" placeholder="@perfil (opcional)" value="${valor("perfil")}"></label>
          <label>🏷️ Nicho<input name="nicho" list="vir-nichos" placeholder="Ex: Casa" value="${valor("nicho")}"><datalist id="vir-nichos">${nichos.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></label>
          <div class="inteira vir-numeros">
            <label>👀 Visualizações<input name="visualizacoes" placeholder="Ex: 1,2M" value="${valor("visualizacoes")}"></label>
            <label>❤️ Curtidas<input name="curtidas" placeholder="Ex: 85 mil" value="${valor("curtidas")}"></label>
            <label>💬 Comentários<input name="comentarios" value="${valor("comentarios")}"></label>
            <label>🔁 Compartilhamentos<input name="compartilhamentos" value="${valor("compartilhamentos")}"></label>
            <label>🔖 Salvamentos<input name="salvamentos" value="${valor("salvamentos")}"></label>
          </div>
          <details class="inteira vir-mais" ${f.legenda || f.transcricao || f.obs ? "open" : ""}>
            <summary>➕ Mais detalhes (opcional): legenda, o que é falado e o que te chamou atenção</summary>
            <div class="form-grade" style="margin-top:10px">
              <label class="inteira">✍️ Legenda do post<textarea name="legenda">${valor("legenda")}</textarea></label>
              <label class="inteira">🗣️ O que é falado no vídeo<textarea name="transcricao" placeholder="Se deixar vazio, eu transcrevo pelo link (usa a chave da Supadata da aba Roteiros).">${valor("transcricao")}</textarea></label>
              <label class="inteira">👀 O que te chamou atenção<textarea name="obs">${valor("obs")}</textarea></label>
            </div>
          </details>
          <div class="form-acoes inteira" style="margin-top:0"><span class="espaco"></span><button type="submit" class="botao botao-principal">🔍 Analisar por que viralizou</button></div>
        </form>
        <div id="vir-aviso" class="rot-aviso" aria-live="polite" hidden></div>
        <div class="rot-config">
          <label for="vir-chave">✨ Chave do Gemini (grátis)</label>
          <input class="campo-busca" id="vir-chave" type="password" autocomplete="off" spellcheck="false" placeholder="${chaveGemini() ? "salva, termina em ••••" + esc(chaveGemini().slice(-4)) : "cole aqui a chave do Google AI Studio"}">
          <button type="button" class="botao botao-leve" id="vir-salvar-chave">💾 Salvar</button>
          ${chaveGemini() ? `<button type="button" class="botao botao-leve" id="vir-tirar-chave">Remover</button>` : ""}
          <span class="dica">${chaveGemini() ? "✅ Chave salva." : `Pegue grátis em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.`} ${chaveSupadata() ? "🎧 Transcrição pela Supadata ligada." : "🎧 Para ouvir pelo link, salve também a chave da Supadata na aba Roteiros."}</span>
        </div>
        <div class="rot-config">
          <label for="vir-chave-groq">🛟 Chave do Groq (grátis, reserva para quando o Gemini chegar no limite)</label>
          <input class="campo-busca" id="vir-chave-groq" type="password" autocomplete="off" spellcheck="false" placeholder="${chaveGroq() ? "salva, termina em ••••" + esc(chaveGroq().slice(-4)) : "cole aqui a chave do Groq (começa com gsk_)"}">
          <button type="button" class="botao botao-leve" id="vir-salvar-groq">💾 Salvar</button>
          ${chaveGroq() ? `<button type="button" class="botao botao-leve" id="vir-tirar-groq">Remover</button>` : ""}
          <span class="dica">${chaveGroq() ? "✅ Reserva ligada: se o Gemini chegar no limite, eu uso o Groq sozinha." : `Pegue grátis em <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> (entre com a conta Google, clique em "Create API Key"). Não pede cartão. Vale para as abas Virais e Tendências.`}</span>
        </div>
      </section>
      <section class="cartao">
        <div class="cartao-topo">
          <h2>🔥 Estruturas que viralizaram <span class="dica">(${dados.virais.length})</span></h2>
          <input class="campo-busca" id="vir-busca" type="search" placeholder="🔎 Buscar por perfil, nicho, gancho..." value="${esc(estadoVir.busca)}">
        </div>
        <div class="rot-lista">${lista.length ? lista.map(cardViral).join("") : `<p class="frase-vazia">${dados.virais.length ? "🔎 Nenhum viral com essa busca." : "📭 Nenhum viral guardado ainda. Cole o link de um conteúdo que bombou aqui em cima e clique em Analisar."}</p>`}</div>
      </section>`;

    desenharAvisoVir();
    const form = $("#vir-form");
    form.addEventListener("input", (e) => { if (e.target.name) estadoVir.form[e.target.name] = e.target.value; });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const valores = {};
      Array.from(form.elements).forEach((el) => { if (el.name) valores[el.name] = el.value.trim(); });
      estadoVir.form = valores;
      analisarViral(valores);
    });
    $("#vir-salvar-chave").addEventListener("click", async () => {
      const valor = $("#vir-chave").value.trim();
      if (!valor) { recado("Cole a chave no campo antes de salvar.", true); $("#vir-chave").focus(); return; }
      try {
        const { error } = await banco.from("configuracoes").upsert({ chave: CHAVE_GEMINI, valor, updated_at: new Date().toISOString() });
        if (error) throw error;
        dados.config[CHAVE_GEMINI] = valor;
        recado("Chave do Gemini salva ✓");
        if (estadoVir.aviso && /Gemini/.test(estadoVir.aviso.html)) avisoVir(null);
        renderVirais(area);
      } catch (erro) { recado(traduzErro(erro, "configuracoes"), true); }
    });
    const tirar = $("#vir-tirar-chave");
    if (tirar) tirar.addEventListener("click", async () => {
      if (!confirm("Remover a chave do Gemini deste painel?")) return;
      try {
        const { error } = await banco.from("configuracoes").delete().eq("chave", CHAVE_GEMINI);
        if (error) throw error;
        delete dados.config[CHAVE_GEMINI];
        recado("Chave removida");
        renderVirais(area);
      } catch (erro) { recado(traduzErro(erro, "configuracoes"), true); }
    });
    $("#vir-salvar-groq").addEventListener("click", async () => {
      const valor = $("#vir-chave-groq").value.trim();
      if (!valor) { recado("Cole a chave no campo antes de salvar.", true); $("#vir-chave-groq").focus(); return; }
      if (await salvarConfig(CHAVE_GROQ, valor)) {
        recado("Chave do Groq salva ✓");
        if (estadoVir.aviso && /limite|Gemini/.test(estadoVir.aviso.html)) avisoVir(null);
        renderVirais(area);
      }
    });
    const tirarGroq = $("#vir-tirar-groq");
    if (tirarGroq) tirarGroq.addEventListener("click", async () => {
      if (!confirm("Remover a chave do Groq deste painel?")) return;
      try {
        const { error } = await banco.from("configuracoes").delete().eq("chave", CHAVE_GROQ);
        if (error) throw error;
        delete dados.config[CHAVE_GROQ];
        recado("Chave removida");
        renderVirais(area);
      } catch (erro) { recado(traduzErro(erro, "configuracoes"), true); }
    });
    $("#vir-busca").addEventListener("input", (e) => {
      estadoVir.busca = e.target.value;
      const pos = e.target.selectionStart;
      renderVirais(area);
      const campo = $("#vir-busca"); campo.focus(); campo.setSelectionRange(pos, pos);
    });
    $$(".rot-lista", area).forEach((caixa) => caixa.addEventListener("click", async (e) => {
      const botao = e.target.closest("[data-acao]");
      if (!botao) return;
      const card = botao.closest(".rot-card");
      const v = card && dados.virais.find((x) => String(x.id) === card.dataset.id);
      if (!v) return;
      const acao = botao.dataset.acao;
      if (acao === "ver") {
        const capa = card.querySelector(".rot-capa");
        capa.classList.add("tocando");
        capa.innerHTML = `<iframe src="${esc(linkEmbed(v.fonte, idDoVideo(v.fonte, v.url)))}" title="Vídeo" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
      }
      if (acao === "ver-analise") verAnalise(v);
      if (acao === "adaptar") adaptarIdeia(v);
      if (acao === "refazer") analisarViral({ url: v.url, transcricao: v.transcricao, perfil: v.perfil }, v);
      if (acao === "apagar") {
        if (!confirm("Apagar este viral e as adaptações dele? Isso não tem volta.")) return;
        if (await apagar("virais", v.id)) { dados.virais = dados.virais.filter((x) => x.id !== v.id); recado("Apagado"); renderVirais(area); }
      }
    }));
  }

  /* =================================================================
     ABA 8: TENDÊNCIAS (o que está em alta no Instagram e no TikTok nos
     temas da Letícia, e como adaptar para a realidade dela)
     Pesquisa pelo Gemini com busca no Google (a mesma chave grátis da aba Virais).
     ================================================================= */
  const TEMAS_PADRAO = [
    "Vida simples na roça",
    "Maternidade e rotina com os filhos",
    "Culinária simples do dia a dia (pão, bolo, comida caseira)",
    "Reforma DIY barata, com achadinhos da Shopee e mão na massa",
    "Horta e plantio",
    "Criação de galinhas",
    "Dicas de casa para facilitar a rotina da dona de casa",
    "Entretenimento que mistura esses temas"
  ];
  const CHAVE_TEMAS = "tendencias_temas";
  const CHAVE_PLATAFORMAS = "tendencias_plataformas";
  const DIAS_PARA_ATUALIZAR = 3;
  const estadoTend = { selecionada: null, tema: "todos", plataforma: "todas", buscando: false, aviso: null, autoTentado: false };
  const lerLista = (chave, padrao) => { try { const v = JSON.parse(dados.config[chave] || "null"); if (Array.isArray(v) && v.length) return v; } catch (erro) { /* usa o padrão */ } return padrao.slice(); };
  const temasTend = () => lerLista(CHAVE_TEMAS, TEMAS_PADRAO);
  const plataformasTend = () => lerLista(CHAVE_PLATAFORMAS, ["Instagram", "TikTok"]);
  const EMOJI_PLATAFORMA = (p) => (/tiktok/i.test(p) && /insta/i.test(p)) || /duas|ambas/i.test(p) ? "📸🎵" : /tiktok/i.test(p) ? "🎵" : /insta/i.test(p) ? "📸" : "✨";

  async function salvarConfig(chave, valor) {
    try {
      const { error } = await banco.from("configuracoes").upsert({ chave, valor, updated_at: new Date().toISOString() });
      if (error) throw error;
      dados.config[chave] = valor;
      return true;
    } catch (erro) { recado(traduzErro(erro, "configuracoes"), true); return false; }
  }

  function fontesUnicas(lista) {
    const vistos = new Set();
    return lista.filter((f) => f && f.link && !vistos.has(f.link) && vistos.add(f.link)).slice(0, 25);
  }
  /* pesquisa na internet: Gemini com Google, depois Groq com busca, e por último sem busca */
  async function perguntarGeminiComBusca(prompt) {
    const falhas = [];
    if (chaveGemini()) {
      for (const modelo of MODELOS_GEMINI) {
        const r = await chamarGemini(modelo, chaveGemini(), { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.8 } });
        if (r.texto) {
          const json = lerJSON(r.texto);
          const fontes = ((r.candidato.groundingMetadata && r.candidato.groundingMetadata.groundingChunks) || [])
            .map((c) => c && c.web).filter((w) => w && w.uri).map((w) => ({ titulo: w.title || w.uri, link: w.uri }));
          return { json, fontes: fontesUnicas(fontes), comBusca: true, motor: "Gemini" };
        }
        if (r.falha === "chave") { falhas.push("chave-gemini"); break; }
        falhas.push(r.falha);
      }
    }
    if (chaveGroq()) {
      for (const modelo of MODELOS_GROQ_BUSCA) {
        const r = await chamarGroq(modelo, prompt, 0.8, false);
        if (r.texto) {
          const json = lerJSON(r.texto);
          const fontes = [];
          ((r.mensagem && r.mensagem.executed_tools) || []).forEach((ferramenta) => {
            const resultados = (ferramenta && ferramenta.search_results && ferramenta.search_results.results) || [];
            resultados.forEach((s) => { if (s && s.url) fontes.push({ titulo: s.title || s.url, link: s.url }); });
          });
          return { json, fontes: fontesUnicas(fontes), comBusca: true, motor: "Groq" };
        }
        if (r.falha === "chave") { falhas.push("chave-groq"); break; }
        falhas.push(r.falha);
      }
    }
    /* sem busca na internet disponível agora: pede só com o que a inteligência artificial já sabe */
    if (falhas.includes("sem-busca") || falhas.includes("outro") || (chaveGroq() && !falhas.includes("chave-groq"))) {
      try { return { json: await perguntarGemini(prompt, 0.8), fontes: [], comBusca: false, motor: "" }; }
      catch (erro) { /* usa a mensagem abaixo */ }
    }
    throw new Error(erroDaIA(falhas));
  }

  function promptTendencias(temas, plataformas) {
    const hoje = new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    return `Hoje é ${hoje}. Você é pesquisadora de tendências de conteúdo para ${plataformas.join(" e ")} no Brasil.
Pesquise na internet o que está em alta AGORA (últimos 30 dias) nos temas abaixo: trends, áudios em alta, formatos de vídeo, desafios e assuntos que estão gerando muitas visualizações, comentários, compartilhamentos ou salvamentos.

Temas da creator:
${temas.map((t) => "- " + t).join("\n")}

Sobre a creator: Letícia Gabrielly (@leh.gsilva), creator UGC que mora na roça em Minas Gerais com os filhos. Mostra uma vida simples na roça, cozinha comida caseira e gostosa (pão, bolo, comida do dia a dia, nada chique), faz reformas baratas ela mesma com achadinhos da Shopee, está começando uma horta e quer criar galinhas. O conteúdo dela é real, aconchegante, com a naturalidade de uma amiga.

Traga de 8 a 10 tendências DIFERENTES entre si, espalhadas pelos temas, priorizando as que ela consegue gravar com a realidade dela. Não invente números. Se não encontrar números, escreva em "sinais" o que você encontrou (ex: muitos vídeos usando o mesmo áudio, comentários pedindo a receita).

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, exatamente neste formato:
{
  "resumo": "duas frases sobre o que está acontecendo nesses temas agora",
  "tendencias": [
    {
      "titulo": "nome curto da tendência",
      "plataforma": "Instagram, TikTok ou As duas",
      "tema": "um dos temas da lista, escrito igual",
      "formato": "formato do vídeo, ex: antes e depois, POV, receita em tempo real, vlog do dia",
      "o_que_e": "o que é a tendência, em uma ou duas frases",
      "por_que_esta_bombando": "por que está funcionando agora",
      "sinais": "o que mostra que está em alta",
      "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
      "audio": "nome do áudio em alta, se tiver, ou vazio",
      "busca": "termo curto para procurar exemplos na plataforma",
      "como_adaptar": "ideia concreta de como ela traz isso para a realidade dela, citando a roça, os filhos, a horta, as galinhas, a cozinha simples ou a reforma barata quando fizer sentido",
      "gancho": "frase de gancho pronta para os primeiros 3 segundos",
      "roteiro": ${MODELO_BLOCOS_ROTEIRO},
      "legenda": "legenda pronta, com no máximo 3 hashtags",
      "dificuldade": "fácil ou média",
      "validade": "aproveite logo ou dura bastante"
    }
  ]
}

${REGRAS_ROTEIRO}
- Cada roteiro com 4 a 6 blocos, de 15 a 45 segundos no total.
Regras gerais: português do Brasil, linguagem simples, nada robotizado e nunca use travessão.`;
  }

  async function buscarTendencias(automatica) {
    if (estadoTend.buscando) return;
    if (!temIA()) { avisoTend("erro", `✨ Para eu pesquisar as tendências, falta a chave grátis do Gemini. É a mesma da aba <a href="#virais">🔥 Virais</a>: salve ela lá e volte aqui.`); return; }
    const temas = temasTend(), plataformas = plataformasTend();
    if (!temas.length || !plataformas.length) { avisoTend("erro", "Escolha pelo menos um tema e uma plataforma."); return; }
    estadoTend.buscando = true;
    const inicio = Date.now();
    const andar = () => avisoTend("andamento", `🔎 ${automatica ? "Atualizando sozinha as tendências" : "Pesquisando o que está em alta"} no ${plataformas.join(" e no ")}… ${Math.round((Date.now() - inicio) / 1000)}s. Costuma levar menos de 1 minuto.`);
    andar();
    const relogio = setInterval(andar, 3000);
    try {
      const { json, fontes, comBusca, motor } = await perguntarGeminiComBusca(promptTendencias(temas, plataformas));
      const itens = (Array.isArray(json.tendencias) ? json.tendencias : []).filter((x) => x && x.titulo).map((x, i) => ({ ...x, id: "t" + Date.now() + i, status: "nova" }));
      if (!itens.length) throw new Error("Não encontrei tendências dessa vez. Tente buscar de novo.");
      const linha = await gravar("tendencias", { nichos: temas, plataformas, resumo: semTravessao(json.resumo || ""), itens, fontes, sem_busca: !comBusca });
      clearInterval(relogio);
      estadoTend.buscando = false;
      if (!linha) { avisoTend("erro", "😕 Achei as tendências, mas não consegui guardar porque a tabela de tendências ainda não existe no Supabase. Clique em Copiar o SQL, cole no SQL Editor, clique em Run e busque de novo.", { texto: "📋 Copiar o SQL", fazer: copiarSQL }); return; }
      dados.tendencias.unshift(linha);
      estadoTend.selecionada = linha.id;
      avisoTend("ok", `✅ ${plural(itens.length, "tendência nova encontrada", "tendências novas encontradas")}${motor === "Groq" ? " (pelo Groq, porque o Gemini estava no limite)" : ""}${comBusca ? "" : ". Desta vez não consegui pesquisar na internet, então as ideias vieram do que a inteligência artificial já sabe"}.`);
      if (abaAtual() === "tendencias") renderTendencias($("#area"));
    } catch (erro) {
      clearInterval(relogio);
      estadoTend.buscando = false;
      avisoTend("erro", "😕 " + esc(erro.message || "A busca não deu certo agora."));
    }
  }

  function avisoTend(tipo, html, acao) {
    estadoTend.aviso = tipo ? { tipo, html, acao } : null;
    const el = $("#tend-aviso");
    if (!el) return;
    const a = estadoTend.aviso;
    if (!a) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.className = "rot-aviso " + a.tipo;
    el.innerHTML = `<span>${a.html}</span>${a.acao ? `<button type="button" class="botao botao-leve" id="tend-aviso-acao">${esc(a.acao.texto)}</button>` : ""}`;
    if (a.acao) $("#tend-aviso-acao").addEventListener("click", a.acao.fazer);
  }

  function textoTendencia(x) {
    const t = semTravessao;
    return [t(x.titulo), "", `Gancho: ${t(x.gancho)}`, "", `Como adaptar: ${t(x.como_adaptar)}`, "", "Roteiro:", textoBlocos(x.roteiro), "", `Legenda: ${t(x.legenda)}`].join("\n");
  }
  function linkExemplos(x, plataforma) {
    const termo = x.busca || (x.hashtags && x.hashtags[0]) || x.titulo;
    if (plataforma === "tiktok") return `https://www.tiktok.com/search?q=${encodeURIComponent(String(termo).replace(/^#/, ""))}`;
    const tag = String((x.hashtags && x.hashtags[0]) || termo).replace(/^#/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]/g, "").toLowerCase();
    return `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
  }

  function cardTendencia(x) {
    const t = (v) => esc(semTravessao(v));
    return `<article class="tend-card ${x.status === "quero" ? "quero" : ""} ${x.status === "feito" ? "feito" : ""}" data-item="${esc(x.id)}">
      <div class="tend-topo">
        <span class="tend-plataforma" title="${t(x.plataforma)}">${EMOJI_PLATAFORMA(x.plataforma || "")}</span>
        ${x.tema ? `<span class="pilula p-minha">${t(x.tema)}</span>` : ""}
        ${x.dificuldade ? `<span class="pilula">${/f[aá]cil/i.test(x.dificuldade) ? "🟢" : "🟡"} ${t(x.dificuldade)}</span>` : ""}
        ${x.validade ? `<span class="pilula ${/logo/i.test(x.validade) ? "p-outra" : ""}">${/logo/i.test(x.validade) ? "⏰" : "🌱"} ${t(x.validade)}</span>` : ""}
        ${x.status === "quero" ? `<span class="pilula tend-marca">⭐ Quero fazer</span>` : ""}${x.status === "feito" ? `<span class="pilula tend-marca">✅ Já fiz</span>` : ""}
      </div>
      <h3>${t(x.titulo)}</h3>
      ${x.formato ? `<p class="dica">🎬 ${t(x.formato)}</p>` : ""}
      <p>${t(x.o_que_e)}</p>
      <p><b>🔥 Por que está bombando:</b> ${t(x.por_que_esta_bombando)}${x.sinais ? ` <span class="dica">(${t(x.sinais)})</span>` : ""}</p>
      <div class="tend-adaptar"><b>💡 Como você pode trazer para a sua realidade</b><p>${t(x.como_adaptar)}</p></div>
      ${x.gancho ? `<p class="tend-gancho">🎣 "${t(x.gancho)}"</p>` : ""}
      <div class="rot-meta">
        ${(x.hashtags || []).slice(0, 5).map((h) => `<span class="pilula rot-tag">${t(String(h).startsWith("#") ? h : "#" + h)}</span>`).join("")}
        ${x.audio ? `<span class="pilula">🎵 ${t(x.audio)}</span>` : ""}
      </div>
      <div class="rot-acoes">
        <button type="button" class="botao botao-principal" data-acao="roteiro">🎬 Ver roteiro</button>
        <a class="botao botao-leve" href="${esc(linkExemplos(x, "tiktok"))}" target="_blank" rel="noopener">🎵 Exemplos no TikTok</a>
        <a class="botao botao-leve" href="${esc(linkExemplos(x, "instagram"))}" target="_blank" rel="noopener">📸 no Instagram</a>
        <button type="button" class="botao botao-leve" data-acao="quero">${x.status === "quero" ? "⭐ Tirar da lista" : "⭐ Quero fazer"}</button>
        <button type="button" class="botao botao-leve" data-acao="feito">${x.status === "feito" ? "↩️ Ainda não fiz" : "✅ Já fiz"}</button>
      </div>
    </article>`;
  }

  async function mudarItem(busca, itemId, mudanca) {
    const itens = (busca.itens || []).map((x) => (x.id === itemId ? { ...x, ...mudanca } : x));
    const linha = await gravar("tendencias", { itens }, busca.id);
    if (linha) { trocarNaLista(dados.tendencias, linha); return linha; }
    return null;
  }
  function verRoteiroTendencia(busca, x) {
    abrirModal(`🎬 ${semTravessao(x.titulo)}`, `<div class="ficha vir-resultado">
        <h3>💡 Como adaptar</h3><p>${esc(semTravessao(x.como_adaptar))}</p>
        <h3>🎣 Gancho</h3><p class="gancho">"${esc(semTravessao(x.gancho))}"</p>
        <h3>🎬 Roteiro</h3>${tabelaRoteiro(x.roteiro)}
        <h3>✍️ Legenda</h3><p>${esc(semTravessao(x.legenda))}</p>
      </div>
      <div class="form-acoes">
        <span class="espaco"></span>
        <button type="button" class="botao botao-leve" id="tend-copiar">📋 Copiar roteiro</button>
        <button type="button" class="botao botao-principal" id="tend-salvar">💾 Salvar nos meus roteiros</button>
      </div>`, true);
    $("#tend-copiar").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(textoTendencia(x)); e.target.textContent = "copiado ✓"; }
      catch (erro) { recado("Não consegui copiar. Selecione o texto e copie.", true); }
    });
    $("#tend-salvar").addEventListener("click", async (e) => {
      e.target.disabled = true;
      const linha = await gravar("roteiros", {
        fonte: "manual", url: "", perfil: "@leh.gsilva", de_quem: "minha", titulo: semTravessao(x.titulo).slice(0, 200),
        transcricao: textoTendencia(x), legenda: semTravessao(x.legenda || ""), tags: ["tendencia"].concat(x.tema ? [String(x.tema).split(/[ ,(]/)[0].toLowerCase()] : []),
        obs: `Ideia da aba Tendências (${dataBR(String(busca.created_at).slice(0, 10))}). ${semTravessao(x.por_que_esta_bombando || "")}`, status: "pronto"
      });
      if (linha) {
        trocarNaLista(dados.roteiros, linha); ordenarRoteiros();
        e.target.textContent = "salvo na aba Roteiros ✓";
        if (x.status !== "feito") { await mudarItem(busca, x.id, { status: "quero" }); if (abaAtual() === "tendencias") renderTendencias($("#area")); }
      } else e.target.disabled = false;
    });
  }

  function renderTendencias(area) {
    const temas = temasTend(), plataformas = plataformasTend();
    const buscas = dados.tendencias;
    const atual = buscas.find((b) => b.id === estadoTend.selecionada) || buscas[0] || null;
    const ultima = buscas[0];
    const diasDesde = ultima ? Math.floor((Date.now() - new Date(ultima.created_at)) / 86400000) : null;
    const itens = atual ? (atual.itens || []) : [];
    const temasNaBusca = Array.from(new Set(itens.map((x) => x.tema).filter(Boolean)));
    const filtrados = itens.filter((x) =>
      (estadoTend.tema === "todos" || (estadoTend.tema === "quero" ? x.status === "quero" : x.tema === estadoTend.tema)) &&
      (estadoTend.plataforma === "todas" || new RegExp(estadoTend.plataforma, "i").test(x.plataforma || "") || /duas|ambas/i.test(x.plataforma || "")));
    const quando = (b) => { const d = new Date(b.created_at); return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} às ${dois(d.getHours())}:${dois(d.getMinutes())}`; };

    area.innerHTML = `
      <section class="cartao rot-topo">
        <p class="rot-frase">Eu pesquiso o que está em alta no Instagram e no TikTok nos seus temas e te mostro como trazer para a sua realidade. Atualizo sozinha quando você abre esta aba e a última busca tem mais de ${DIAS_PARA_ATUALIZAR} dias.</p>
        <div class="rot-linha">
          <span class="dica" style="flex:1">${ultima ? `🗓️ Última busca: ${quando(ultima)} (${diasDesde === 0 ? "hoje" : diasDesde === 1 ? "ontem" : `há ${diasDesde} dias`})` : "🗓️ Nenhuma busca ainda."}</span>
          <button type="button" class="botao botao-principal" id="tend-buscar" ${estadoTend.buscando ? "disabled" : ""}>🔎 Buscar tendências agora</button>
        </div>
        <div id="tend-aviso" class="rot-aviso" aria-live="polite" hidden></div>
        <details class="tend-temas">
          <summary>🎯 Meus temas e plataformas (${temas.length} temas · ${plataformas.join(" e ") || "nenhuma"})</summary>
          <div class="tend-temas-corpo">
            <div class="tend-chips">${temas.map((t, i) => `<span class="tend-chip">${esc(t)}<button type="button" data-tirar-tema="${i}" aria-label="Tirar o tema ${esc(t)}">×</button></span>`).join("")}</div>
            <form class="rot-linha" id="tend-novo-tema"><input class="campo-busca" name="tema" placeholder="+ Adicionar um tema, ex: Receitas com milho" style="flex:1"><button type="submit" class="botao botao-leve">Adicionar</button>
              ${temas.join("|") !== TEMAS_PADRAO.join("|") ? `<button type="button" class="botao botao-leve" id="tend-padrao">Voltar aos temas iniciais</button>` : ""}</form>
            <div class="chips" role="group" aria-label="Plataformas">
              ${["Instagram", "TikTok"].map((p) => `<button type="button" data-plataforma-config="${p}" aria-pressed="${plataformas.includes(p)}">${p === "Instagram" ? "📸" : "🎵"} ${p}</button>`).join("")}
            </div>
          </div>
        </details>
      </section>
      ${atual ? `
      <section class="cartao">
        <div class="cartao-topo">
          <h2>📈 Em alta agora <span class="dica">(${itens.length})</span></h2>
          ${buscas.length > 1 ? `<select class="filtro" id="tend-historico" aria-label="Buscas anteriores">${buscas.map((b) => `<option value="${esc(b.id)}" ${b.id === atual.id ? "selected" : ""}>Busca de ${quando(b)}</option>`).join("")}</select>` : ""}
        </div>
        ${atual.resumo ? `<p class="tend-resumo">🧭 ${esc(atual.resumo)}</p>` : ""}
        ${atual.sem_busca ? `<p class="dica">⚠️ Nesta busca não consegui pesquisar na internet, então as ideias vieram do que a inteligência artificial já sabe.</p>` : ""}
        <div class="ferramentas" style="margin:12px 0">
          <div class="chips" role="group" aria-label="Filtrar por tema">
            ${[["todos", "Todos"], ["quero", "⭐ Quero fazer"]].concat(temasNaBusca.map((t) => [t, t])).map(([v, t]) => `<button type="button" data-tema="${esc(v)}" aria-pressed="${estadoTend.tema === v}">${esc(t)}</button>`).join("")}
          </div>
          <div class="chips" role="group" aria-label="Filtrar por plataforma">
            ${[["todas", "Todas"], ["instagram", "📸 Instagram"], ["tiktok", "🎵 TikTok"]].map(([v, t]) => `<button type="button" data-plataforma="${v}" aria-pressed="${estadoTend.plataforma === v}">${t}</button>`).join("")}
          </div>
        </div>
        <div class="tend-grade">${filtrados.length ? filtrados.map(cardTendencia).join("") : `<p class="frase-vazia">Nenhuma tendência com esse filtro.</p>`}</div>
        ${(atual.fontes || []).length ? `<details class="tend-fontes"><summary>📚 Onde eu pesquisei (${atual.fontes.length})</summary><ul class="lista-simples">${atual.fontes.slice(0, 20).map((f) => `<li><a href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.titulo)}</a></li>`).join("")}</ul></details>` : ""}
      </section>` : `
      <section class="cartao"><p class="frase-vazia">📭 Ainda não tenho tendências guardadas. ${temIA() ? "Clique em Buscar tendências agora." : "Salve a chave grátis do Gemini na aba 🔥 Virais e volte aqui."}</p></section>`}`;

    avisoTend(estadoTend.aviso ? estadoTend.aviso.tipo : null, estadoTend.aviso ? estadoTend.aviso.html : "", estadoTend.aviso ? estadoTend.aviso.acao : null);
    $("#tend-buscar").addEventListener("click", () => buscarTendencias(false));
    const hist = $("#tend-historico");
    if (hist) hist.addEventListener("change", (e) => { estadoTend.selecionada = e.target.value; estadoTend.tema = "todos"; renderTendencias(area); });
    $$("[data-tema]", area).forEach((b) => b.addEventListener("click", () => { estadoTend.tema = b.dataset.tema; renderTendencias(area); }));
    $$("[data-plataforma]", area).forEach((b) => b.addEventListener("click", () => { estadoTend.plataforma = b.dataset.plataforma; renderTendencias(area); }));
    $$("[data-tirar-tema]", area).forEach((b) => b.addEventListener("click", async () => {
      const lista = temasTend(); lista.splice(Number(b.dataset.tirarTema), 1);
      if (!lista.length) { recado("Deixe pelo menos um tema.", true); return; }
      if (await salvarConfig(CHAVE_TEMAS, JSON.stringify(lista))) { renderTendencias(area); $(".tend-temas", area).open = true; }
    }));
    $("#tend-novo-tema").addEventListener("submit", async (e) => {
      e.preventDefault();
      const novo = e.target.elements.tema.value.trim();
      if (!novo) return;
      const lista = temasTend(); if (!lista.includes(novo)) lista.push(novo);
      if (await salvarConfig(CHAVE_TEMAS, JSON.stringify(lista))) { recado("Tema adicionado ✓. Ele entra na próxima busca."); renderTendencias(area); $(".tend-temas", area).open = true; }
    });
    const padrao = $("#tend-padrao");
    if (padrao) padrao.addEventListener("click", async () => { if (await salvarConfig(CHAVE_TEMAS, JSON.stringify(TEMAS_PADRAO))) { renderTendencias(area); $(".tend-temas", area).open = true; } });
    $$("[data-plataforma-config]", area).forEach((b) => b.addEventListener("click", async () => {
      const lista = plataformasTend(); const p = b.dataset.plataformaConfig;
      const nova = lista.includes(p) ? lista.filter((x) => x !== p) : lista.concat([p]);
      if (!nova.length) { recado("Deixe pelo menos uma plataforma.", true); return; }
      if (await salvarConfig(CHAVE_PLATAFORMAS, JSON.stringify(nova))) { renderTendencias(area); $(".tend-temas", area).open = true; }
    }));
    const grade = $(".tend-grade", area);
    if (grade) grade.addEventListener("click", async (e) => {
      const botao = e.target.closest("[data-acao]");
      if (!botao || !atual) return;
      const x = (atual.itens || []).find((i) => i.id === botao.closest("[data-item]").dataset.item);
      if (!x) return;
      if (botao.dataset.acao === "roteiro") verRoteiroTendencia(atual, x);
      if (botao.dataset.acao === "quero" || botao.dataset.acao === "feito") {
        const alvo = botao.dataset.acao;
        botao.disabled = true;
        if (await mudarItem(atual, x.id, { status: x.status === alvo ? "nova" : alvo })) renderTendencias(area);
        else botao.disabled = false;
      }
    });

    /* atualização sozinha: ao abrir a aba, se a última busca tiver mais de 3 dias */
    if (!estadoTend.autoTentado && temIA() && (diasDesde === null || diasDesde >= DIAS_PARA_ATUALIZAR) && !avisosMostrados.has("tabela-tendencias")) {
      estadoTend.autoTentado = true;
      buscarTendencias(true);
    }
  }

  /* ---------------------------------------------------------------
     5) COMEÇA
     --------------------------------------------------------------- */
  $("#area").innerHTML = `<div class="cartao"><p class="frase-vazia">Carregando os seus dados...</p></div>`;
  await carregarTudo();
  /* confere se o e-mail que entrou está liberado como dono no banco.sql (senão as listas viriam vazias sem explicação) */
  try {
    const { data, error } = await banco.rpc("e_a_dona");
    if (!error && data === false)
      avisar("dona", `Você entrou com ${sessao.user.email || "um e-mail"}, mas esse e-mail não está liberado como dono do painel. Por isso as listas aparecem vazias e nada salva. Coloque esse e-mail na parte 1 do banco.sql e rode o arquivo de novo no Supabase.`);
  } catch (erro) { /* se a função ainda não existe, os avisos das tabelas já explicam */ }
  mostrarAba();
})();
