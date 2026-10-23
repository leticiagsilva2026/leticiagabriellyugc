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
    $("#avisos").appendChild(div);
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
    eventos: ["data", "tipo", "alvo", "detalhe", "origem", "dispositivo"]
  };
  const dados = { videos: [], marcas: [], calendario: [], campanhas: [], visitas: [], eventos: [] };
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
    const [v, m, c, cp, mc, vi, ev] = await Promise.all([
      buscar("videos", (q) => q.select("*").order("ordem", { ascending: true }).order("id", { ascending: true })),
      buscar("marcas", (q) => q.select("*").order("id", { ascending: false })),
      buscar("calendario", (q) => q.select("*").order("data", { ascending: true })),
      buscar("campanhas", (q) => q.select("*").order("id", { ascending: false })),
      buscar("marcados", (q) => q.select("*")),
      buscarEmPartes("visitas", desde),
      buscarEmPartes("eventos", desde)
    ]);
    dados.videos = v; dados.marcas = m; dados.calendario = c; dados.campanhas = cp; dados.visitas = vi; dados.eventos = ev;
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
      return `<label class="inteira">${esc(campo.rotulo)}<textarea name="${campo.nome}">${esc(v)}</textarea>${dica}</label>`;
    const lista = campo.lista ? `list="lista-${campo.nome}"` : "";
    const datalist = campo.lista ? `<datalist id="lista-${campo.nome}">${campo.lista.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
    const extra = campo.tipo === "number" ? `min="0" step="${campo.passo || 1}"` : "";
    return `<label class="${classe}">${esc(campo.rotulo)}${campo.obrigatorio ? " *" : ""}<input type="${campo.tipo || "text"}" name="${campo.nome}" value="${esc(v == null ? "" : v)}" ${lista} ${extra}>${datalist}${dica}</label>`;
  }

  function formulario({ titulo, campos, valores = {}, aoSalvar, aoApagar }) {
    const html = `<form class="form-grade" id="form-modal" novalidate>
      ${campos.map((c) => campoHTML(c, valores)).join("")}
      <div class="form-acoes inteira">
        ${aoApagar ? '<button type="button" class="botao botao-perigo" id="form-apagar">Apagar</button>' : ""}
        <span class="espaco"></span>
        <button type="button" class="botao botao-leve" id="form-cancelar">Cancelar</button>
        <button type="submit" class="botao botao-principal" id="form-salvar">Salvar</button>
      </div></form>`;
    abrirModal(titulo, html);
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
