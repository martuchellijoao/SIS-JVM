import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ================= Configuração =================
const ESPACOS = { pessoal: 'Pessoal', escritorio: 'Escritório TI' };
const CATEGORIAS_PADRAO = [
  ['Combustível', 'saida'], ['Lanches', 'saida'], ['Bar', 'saida'],
  ['Contas', 'saida'], ['Veículo', 'saida'], ['Salário', 'entrada'],
];
const DEMO = new URLSearchParams(location.search).has('demo');

// ================= Utilidades =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hoje = () => isoLocal(new Date());
const dataDe = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };

function parseValor(txt) {
  let s = String(txt).replace(/R\$|\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const formatarValorInput = (n) => n.toFixed(2).replace('.', ',');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

function traduzErro(e) {
  const m = String(e?.message || e);
  if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sem conexão. Tente novamente.';
  if (/categorias_nome_unico|duplicate/i.test(m)) return 'Já existe uma categoria com esse nome.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Aguarde um pouco.';
  return 'Erro: ' + m;
}

// ================= Acesso aos dados =================
async function criarApi() {
  if (DEMO) return apiDemo();
  if (!SUPABASE_URL || SUPABASE_URL.includes('SEU-PROJETO')) {
    throw new Error('Configure o arquivo config.js com os dados do Supabase.');
  }
  const { createClient } = await import('./supabase.js');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const ok = ({ data, error }) => { if (error) throw error; return data; };

  return {
    async sessao() { return ok(await sb.auth.getSession()).session; },
    async entrar(email, senha) { return ok(await sb.auth.signInWithPassword({ email, password: senha })); },
    async sair() { await sb.auth.signOut(); },
    async contarCategorias() {
      const { count, error } = await sb.from('categorias').select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count;
    },
    async categorias(espaco) {
      return ok(await sb.from('categorias').select('id,nome,tipo,arquivada').eq('espaco', espaco).order('nome'));
    },
    async criarCategorias(lista) { return ok(await sb.from('categorias').insert(lista)); },
    async editarCategoria(id, patch) { return ok(await sb.from('categorias').update(patch).eq('id', id)); },
    async lancamentos(espaco, de, ate) {
      return ok(await sb.from('lancamentos')
        .select('id,categoria_id,tipo,valor,data,descricao')
        .eq('espaco', espaco).gte('data', de).lte('data', ate)
        .order('data', { ascending: false }).order('criado_em', { ascending: false }));
    },
    async salvarLancamento({ id, ...dados }) {
      return ok(id
        ? await sb.from('lancamentos').update(dados).eq('id', id)
        : await sb.from('lancamentos').insert(dados));
    },
    async excluirLancamento(id) { return ok(await sb.from('lancamentos').delete().eq('id', id)); },
  };
}

// Modo demonstração (abra index.html?demo): dados de exemplo só na memória
function apiDemo() {
  let logado = false, seq = 0;
  const uid = () => 'd' + (++seq);
  const cats = [], lancs = [];
  const add = (espaco, nome, tipo) => { const c = { id: uid(), espaco, nome, tipo, arquivada: false }; cats.push(c); return c; };
  const byNome = (n) => cats.find((c) => c.nome === n);
  CATEGORIAS_PADRAO.forEach(([n, t]) => add('pessoal', n, t));
  add('escritorio', 'Serviços', 'entrada'); add('escritorio', 'Equipamentos', 'saida'); add('escritorio', 'Internet', 'saida');
  const d = new Date(); const dia = (n) => isoLocal(new Date(d.getFullYear(), d.getMonth(), Math.min(n, d.getDate())));
  [['Salário', 4200, 5, ''], ['Combustível', 180, 3, 'Posto'], ['Combustível', 150, 1, ''], ['Lanches', 32.5, 4, ''],
   ['Bar', 85, 2, 'Sexta'], ['Contas', 310.4, 5, 'Luz e internet'], ['Veículo', 240, 1, 'Troca de óleo'], ['Lanches', 18, 1, ''],
   ['Serviços', 1500, 2, 'Instalação CFTV'], ['Equipamentos', 620, 3, 'Switch'], ['Internet', 120, 4, '']]
    .forEach(([n, v, di, ds]) => { const c = byNome(n); lancs.push({ id: uid(), espaco: c.espaco, categoria_id: c.id, tipo: c.tipo, valor: v, data: dia(di), descricao: ds }); });
  const espera = () => new Promise((r) => setTimeout(r, 80));
  return {
    async sessao() { return logado ? {} : null; },
    async entrar() { await espera(); logado = true; },
    async sair() { logado = false; },
    async contarCategorias() { return cats.length; },
    async categorias(e) { return cats.filter((c) => c.espaco === e).sort((a, b) => a.nome.localeCompare(b.nome)); },
    async criarCategorias(l) { l.forEach((c) => add(c.espaco, c.nome, c.tipo)); },
    async editarCategoria(id, p) { Object.assign(cats.find((c) => c.id === id), p); },
    async lancamentos(e, de, ate) {
      return lancs.filter((l) => l.espaco === e && l.data >= de && l.data <= ate).sort((a, b) => b.data.localeCompare(a.data));
    },
    async salvarLancamento({ id, ...dados }) {
      const c = cats.find((x) => x.id === dados.categoria_id);
      const reg = { ...dados, espaco: c.espaco, tipo: c.tipo };
      if (id) Object.assign(lancs.find((l) => l.id === id), reg); else lancs.push({ id: uid(), ...reg });
    },
    async excluirLancamento(id) { lancs.splice(lancs.findIndex((l) => l.id === id), 1); },
  };
}

// ================= Estado =================
let api;
const estado = {
  espaco: lerPref('espaco', 'pessoal'),
  mes: hoje().slice(0, 7),           // "AAAA-MM"
  aba: 'inicio',
  visaoCat: 'saida',                // gráfico do início: saídas ou entradas
  filtroCat: null,                  // filtro da aba lançamentos
  cats: [],
  lancs: [],
};

function lerPref(k, padrao) { try { return localStorage.getItem('fin.' + k) || padrao; } catch { return padrao; } }
function salvarPref(k, v) { try { localStorage.setItem('fin.' + k, v); } catch { /* ignora */ } }

const catPorId = (id) => estado.cats.find((c) => c.id === id);
const nomeCat = (id) => catPorId(id)?.nome ?? '—';

function intervaloMes() {
  const [a, m] = estado.mes.split('-').map(Number);
  return [isoLocal(new Date(a, m - 1, 1)), isoLocal(new Date(a, m, 0))];
}

// ================= Inicialização =================
async function iniciar() {
  try {
    api = await criarApi();
  } catch (e) {
    mostrarLogin(e.message);
    $('#form-login button').disabled = true;
    return;
  }
  ligarEventos();
  // não deixa a tela presa se o Supabase demorar a responder
  const limite = new Promise((r) => setTimeout(() => r(null), 8000));
  const sessao = await Promise.race([api.sessao().catch(() => null), limite]);
  if (sessao) await entrarNoApp(); else mostrarLogin();
}

// Mostra na tela qualquer erro inesperado (em vez de ficar tudo em branco)
function mostrarErroFatal(msg) {
  const c = $('#carregando');
  if (c && !c.hidden) $('#carregando-erro').textContent = 'Erro ao iniciar: ' + msg;
}
window.addEventListener('error', (e) => mostrarErroFatal(e.message));
window.addEventListener('unhandledrejection', (e) => mostrarErroFatal(e.reason?.message || e.reason));

function mostrarLogin(msg = '') {
  $('#carregando').hidden = true;
  $('#tela-app').hidden = true;
  $('#tela-login').hidden = false;
  $('#login-erro').textContent = msg;
}

async function entrarNoApp() {
  $('#carregando').hidden = true;
  $('#tela-login').hidden = true;
  $('#tela-app').hidden = false;
  try {
    // Primeiro acesso: cria as categorias iniciais do espaço Pessoal
    if ((await api.contarCategorias()) === 0) {
      await api.criarCategorias(CATEGORIAS_PADRAO.map(([nome, tipo]) => ({ espaco: 'pessoal', nome, tipo })));
    }
  } catch (e) { toast(traduzErro(e)); }
  await recarregar(true);
}

async function recarregar(comCategorias = false) {
  const [de, ate] = intervaloMes();
  try {
    const [cats, lancs] = await Promise.all([
      comCategorias ? api.categorias(estado.espaco) : estado.cats,
      api.lancamentos(estado.espaco, de, ate),
    ]);
    estado.cats = cats;
    estado.lancs = lancs.map((l) => ({ ...l, valor: Number(l.valor) }));
  } catch (e) {
    toast(traduzErro(e));
  }
  render();
}

// ================= Renderização =================
function render() {
  $$('#seg-espaco button').forEach((b) => b.classList.toggle('ativo', b.dataset.espaco === estado.espaco));
  $$('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === estado.aba));
  ['inicio', 'lancamentos', 'categorias'].forEach((a) => { $('#aba-' + a).hidden = a !== estado.aba; });
  $('#barra-mes').hidden = estado.aba === 'categorias';
  const [a, m] = estado.mes.split('-').map(Number);
  const nomeMes = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  $('#mes-nome').textContent = `${nomeMes.charAt(0).toUpperCase()}${nomeMes.slice(1)} de ${a}`;

  if (estado.aba === 'inicio') renderInicio();
  if (estado.aba === 'lancamentos') renderLancamentos();
  if (estado.aba === 'categorias') renderCategorias();
  $$('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; });
}

function totais(lista) {
  let ent = 0, sai = 0;
  lista.forEach((l) => { if (l.tipo === 'entrada') ent += l.valor; else sai += l.valor; });
  return { ent, sai, saldo: ent - sai };
}

function renderInicio() {
  const { ent, sai, saldo } = totais(estado.lancs);
  const tipo = estado.visaoCat;
  const porCat = new Map();
  estado.lancs.filter((l) => l.tipo === tipo).forEach((l) => porCat.set(l.categoria_id, (porCat.get(l.categoria_id) || 0) + l.valor));
  const linhas = [...porCat.entries()].sort((x, y) => y[1] - x[1]);
  const total = tipo === 'saida' ? sai : ent;
  const maior = linhas[0]?.[1] || 1;

  const barras = linhas.length
    ? `<div class="barras ${tipo}-cor">${linhas.map(([id, v]) => `
        <button class="barra" data-cat="${esc(id)}">
          <div class="barra-topo"><span>${esc(nomeCat(id))}<small>${Math.round((v / total) * 100)}%</small></span><span>${brl.format(v)}</span></div>
          <div class="trilho"><i data-w="${((v / maior) * 100).toFixed(1)}"></i></div>
        </button>`).join('')}</div>`
    : `<div class="vazio">Nenhuma ${tipo === 'saida' ? 'saída' : 'entrada'} neste mês.</div>`;

  $('#aba-inicio').innerHTML = `
    <div class="resumo">
      <div class="cartao saldo"><div class="k-rotulo">Saldo do mês</div><div class="k-valor ${saldo >= 0 ? 'pos' : 'neg'}">${brl.format(saldo)}</div></div>
      <div class="cartao"><div class="k-rotulo">Entradas</div><div class="k-valor pos">${brl.format(ent)}</div></div>
      <div class="cartao"><div class="k-rotulo">Saídas</div><div class="k-valor neg">${brl.format(sai)}</div></div>
    </div>
    <div class="titulo-sec">
      <h3>Por categoria</h3>
      <div class="seg seg-tipo" id="seg-visao">
        <button data-tipo="saida" class="${tipo === 'saida' ? 'ativo' : ''}">Saídas</button>
        <button data-tipo="entrada" class="${tipo === 'entrada' ? 'ativo' : ''}">Entradas</button>
      </div>
    </div>
    <div class="cartao">${barras}</div>
    <div class="titulo-sec"><h3>Últimos lançamentos</h3>${estado.lancs.length ? '<button class="link" data-ir="lancamentos">Ver todos</button>' : ''}</div>
    ${estado.lancs.length ? `<div class="lista">${estado.lancs.slice(0, 5).map(itemLanc).join('')}</div>`
      : '<div class="cartao vazio">Toque no <strong>+</strong> para lançar seu primeiro gasto ou entrada.</div>'}`;
}

function itemLanc(l) {
  const nome = nomeCat(l.categoria_id);
  const sub = [dataDe(l.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), l.descricao].filter(Boolean).join(' · ');
  return `<button class="item" data-lanc="${esc(l.id)}">
    <span class="bolinha ${l.tipo}">${esc(nome.charAt(0).toUpperCase())}</span>
    <span class="item-meio"><div>${esc(nome)}</div><small>${esc(sub)}</small></span>
    <span class="item-valor ${l.tipo}">${l.tipo === 'saida' ? '−' : '+'} ${brl.format(l.valor)}</span>
  </button>`;
}

function renderLancamentos() {
  const lista = estado.filtroCat ? estado.lancs.filter((l) => l.categoria_id === estado.filtroCat) : estado.lancs;
  const { ent, sai } = totais(lista);
  let html = '';
  if (estado.filtroCat) {
    html += `<div class="filtro">${esc(nomeCat(estado.filtroCat))}<button id="limpar-filtro" aria-label="Remover filtro"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
  }
  html += `<div class="totais-linha"><span class="pos">+ ${brl.format(ent)}</span><span class="neg">− ${brl.format(sai)}</span></div>`;
  if (!lista.length) {
    html += '<div class="cartao vazio mt">Nenhum lançamento neste mês.</div>';
  } else {
    const grupos = new Map();
    lista.forEach((l) => { if (!grupos.has(l.data)) grupos.set(l.data, []); grupos.get(l.data).push(l); });
    grupos.forEach((itens, data) => {
      const rot = data === hoje() ? 'Hoje' : dataDe(data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
      html += `<div class="dia">${esc(rot)}</div><div class="lista">${itens.map(itemLanc).join('')}</div>`;
    });
  }
  $('#aba-lancamentos').innerHTML = html;
}

function renderCategorias() {
  const grupo = (titulo, itens, arquivadas = false) => itens.length ? `
    <div class="cat-grupo"><h3>${titulo}</h3><div class="lista">${itens.map((c) => `
      <button class="item" data-cat-edit="${esc(c.id)}">
        <span class="bolinha ${c.tipo}">${esc(c.nome.charAt(0).toUpperCase())}</span>
        <span class="item-meio"><div>${esc(c.nome)}</div>${arquivadas ? `<small>${c.tipo === 'saida' ? 'Saída' : 'Entrada'}</small>` : ''}</span>
        <span class="acao">${arquivadas ? 'Restaurar' : 'Editar'}</span>
      </button>`).join('')}</div></div>` : '';
  const ativas = estado.cats.filter((c) => !c.arquivada);
  const html =
    grupo('Saídas', ativas.filter((c) => c.tipo === 'saida')) +
    grupo('Entradas', ativas.filter((c) => c.tipo === 'entrada')) +
    grupo('Arquivadas', estado.cats.filter((c) => c.arquivada), true);
  $('#aba-categorias').innerHTML =
    (html || `<div class="cartao vazio mt">Nenhuma categoria em ${esc(ESPACOS[estado.espaco])} ainda.</div>`) +
    '<button class="btn btn-secundario btn-nova" id="btn-nova-cat">+ Nova categoria</button>';
}

// ================= Formulário de lançamento =================
const formLanc = { id: null, tipo: 'saida', cat: null };

function abrirLancamento(l = null) {
  formLanc.id = l?.id ?? null;
  formLanc.tipo = l?.tipo ?? 'saida';
  formLanc.cat = l?.categoria_id ?? null;
  $('#lanc-titulo').textContent = l ? 'Editar lançamento' : 'Novo lançamento';
  $('#lanc-valor').value = l ? formatarValorInput(l.valor) : '';
  $('#lanc-data').value = l?.data ?? hoje();
  $('#lanc-desc').value = l?.descricao ?? '';
  $('#lanc-excluir').hidden = !l;
  $('#lanc-erro').textContent = '';
  renderFormLanc();
  $('#dlg-lanc').showModal();
  if (!l) setTimeout(() => $('#lanc-valor').focus(), 50);
}

function renderFormLanc() {
  $$('#lanc-tipo button').forEach((b) => b.classList.toggle('ativo', b.dataset.tipo === formLanc.tipo));
  // categorias ativas do tipo + a categoria atual (mesmo se arquivada, ao editar)
  const cats = estado.cats.filter((c) => c.tipo === formLanc.tipo && (!c.arquivada || c.id === formLanc.cat));
  if (formLanc.cat && !cats.some((c) => c.id === formLanc.cat)) formLanc.cat = null;
  $('#lanc-cats').innerHTML = cats.length
    ? cats.map((c) => `<button type="button" data-id="${esc(c.id)}" class="${c.id === formLanc.cat ? 'ativo' : ''}">${esc(c.nome)}</button>`).join('')
    : `<div class="vazio">Nenhuma categoria de ${formLanc.tipo === 'saida' ? 'saída' : 'entrada'}. Crie uma na aba Categorias.</div>`;
}

async function salvarLancamento(ev) {
  ev.preventDefault();
  const valor = parseValor($('#lanc-valor').value);
  const erro = $('#lanc-erro');
  if (!(valor > 0)) return (erro.textContent = 'Informe um valor maior que zero.');
  if (!formLanc.cat) return (erro.textContent = 'Escolha uma categoria.');
  if (!$('#lanc-data').value) return (erro.textContent = 'Informe a data.');
  const btn = ev.submitter || $('#form-lanc [type=submit]');
  btn.disabled = true;
  try {
    await api.salvarLancamento({
      id: formLanc.id ?? undefined,
      categoria_id: formLanc.cat,
      valor,
      data: $('#lanc-data').value,
      descricao: $('#lanc-desc').value.trim() || null,
    });
    $('#dlg-lanc').close();
    toast(formLanc.id ? 'Lançamento atualizado' : 'Lançamento salvo');
    await recarregar();
  } catch (e) {
    erro.textContent = traduzErro(e);
  } finally {
    btn.disabled = false;
  }
}

async function excluirLancamento() {
  if (!formLanc.id || !confirm('Excluir este lançamento?')) return;
  try {
    await api.excluirLancamento(formLanc.id);
    $('#dlg-lanc').close();
    toast('Lançamento excluído');
    await recarregar();
  } catch (e) { $('#lanc-erro').textContent = traduzErro(e); }
}

// ================= Formulário de categoria =================
const formCat = { id: null, tipo: 'saida' };

function abrirCategoria(c = null) {
  formCat.id = c?.id ?? null;
  formCat.tipo = c?.tipo ?? 'saida';
  $('#cat-titulo').textContent = c ? 'Editar categoria' : 'Nova categoria';
  $('#cat-nome').value = c?.nome ?? '';
  $('#cat-tipo').hidden = !!c;           // tipo não muda depois de criada
  $('#cat-arquivar').hidden = !c;
  $('#cat-arquivar').textContent = c?.arquivada ? 'Restaurar categoria' : 'Arquivar categoria';
  $('#cat-erro').textContent = '';
  $$('#cat-tipo button').forEach((b) => b.classList.toggle('ativo', b.dataset.tipo === formCat.tipo));
  $('#dlg-cat').showModal();
}

async function salvarCategoria(ev) {
  ev.preventDefault();
  const nome = $('#cat-nome').value.trim().replace(/\s+/g, ' ');
  if (!nome) return ($('#cat-erro').textContent = 'Informe o nome.');
  try {
    if (formCat.id) await api.editarCategoria(formCat.id, { nome });
    else await api.criarCategorias([{ espaco: estado.espaco, nome, tipo: formCat.tipo }]);
    $('#dlg-cat').close();
    toast('Categoria salva');
    await recarregar(true);
  } catch (e) { $('#cat-erro').textContent = traduzErro(e); }
}

async function alternarArquivo() {
  const c = catPorId(formCat.id);
  if (!c) return;
  if (!c.arquivada && !confirm(`Arquivar "${c.nome}"? Ela some das opções de lançamento, mas o histórico continua nos relatórios.`)) return;
  const arquivar = !c.arquivada;
  try {
    await api.editarCategoria(c.id, { arquivada: arquivar });
    $('#dlg-cat').close();
    toast(arquivar ? 'Categoria arquivada' : 'Categoria restaurada');
    await recarregar(true);
  } catch (e) { $('#cat-erro').textContent = traduzErro(e); }
}

// ================= Eventos =================
function ligarEventos() {
  $('#seg-espaco').addEventListener('click', (e) => {
    const b = e.target.closest('[data-espaco]');
    if (!b || b.dataset.espaco === estado.espaco) return;
    estado.espaco = b.dataset.espaco;
    estado.filtroCat = null;
    salvarPref('espaco', estado.espaco);
    recarregar(true);
  });

  $('.abas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aba]');
    if (!b) return;
    estado.aba = b.dataset.aba;
    if (estado.aba !== 'lancamentos') estado.filtroCat = null;
    render();
    window.scrollTo(0, 0);
  });

  const mudarMes = (delta) => {
    const [a, m] = estado.mes.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    estado.mes = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    recarregar();
  };
  $('#mes-ant').addEventListener('click', () => mudarMes(-1));
  $('#mes-prox').addEventListener('click', () => mudarMes(1));

  $('main').addEventListener('click', (e) => {
    const t = e.target;
    const visao = t.closest('#seg-visao [data-tipo]');
    if (visao) { estado.visaoCat = visao.dataset.tipo; return render(); }
    const barra = t.closest('[data-cat]');
    if (barra) { estado.filtroCat = barra.dataset.cat; estado.aba = 'lancamentos'; render(); return window.scrollTo(0, 0); }
    if (t.closest('[data-ir]')) { estado.aba = t.closest('[data-ir]').dataset.ir; return render(); }
    if (t.closest('#limpar-filtro')) { estado.filtroCat = null; return render(); }
    const lanc = t.closest('[data-lanc]');
    if (lanc) return abrirLancamento(estado.lancs.find((l) => l.id === lanc.dataset.lanc));
    const ce = t.closest('[data-cat-edit]');
    if (ce) return abrirCategoria(catPorId(ce.dataset.catEdit));
    if (t.closest('#btn-nova-cat')) return abrirCategoria();
  });

  $('#btn-novo').addEventListener('click', () => (estado.aba === 'categorias' ? abrirCategoria() : abrirLancamento()));

  // formulário de lançamento
  $('#lanc-tipo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tipo]');
    if (!b) return;
    formLanc.tipo = b.dataset.tipo;
    formLanc.cat = null;
    renderFormLanc();
  });
  $('#lanc-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    formLanc.cat = b.dataset.id;
    renderFormLanc();
  });
  $('#form-lanc').addEventListener('submit', salvarLancamento);
  $('#lanc-excluir').addEventListener('click', excluirLancamento);

  // formulário de categoria
  $('#cat-tipo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tipo]');
    if (!b) return;
    formCat.tipo = b.dataset.tipo;
    $$('#cat-tipo button').forEach((x) => x.classList.toggle('ativo', x === b));
  });
  $('#form-cat').addEventListener('submit', salvarCategoria);
  $('#cat-arquivar').addEventListener('click', alternarArquivo);

  // fechar folhas (botão X ou toque fora)
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-fechar]')) d.close(); });
  });

  // login / sair
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#form-login button');
    btn.disabled = true;
    $('#login-erro').textContent = '';
    try {
      await api.entrar($('#login-email').value.trim(), $('#login-senha').value);
      $('#login-senha').value = '';
      await entrarNoApp();
    } catch (err) {
      $('#login-erro').textContent = traduzErro(err);
    } finally { btn.disabled = false; }
  });
  $('#btn-sair').addEventListener('click', async () => {
    if (!confirm('Sair da conta?')) return;
    await api.sair();
    estado.cats = []; estado.lancs = [];
    mostrarLogin();
  });

  // atualiza ao voltar para o app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('#tela-app').hidden) recarregar(true);
  });
}

// ================= PWA =================
if ('serviceWorker' in navigator && !DEMO) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
