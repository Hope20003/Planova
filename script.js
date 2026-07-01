/*
 * ============================================================
 *  PLANÔVA — script.js
 *  Lógica principal do planejamento financeiro.
 *
 *  ESTRUTURA GERAL:
 *  1.  MULTI-META: chaves de localStorage e índice ativo
 *  2.  BOTÕES X NAS LINHAS (limpar + subcategoria + replicar)
 *  3.  SUBCATEGORIA: popup para detalhar uma despesa
 *  4.  REPLICAR NOS PRÓXIMOS MESES: copia linha para N meses
 *  5.  DETECTAR / RESOLVER CONFLITOS de duplicata
 *  6.  CORES DOS BANCOS nos selects customizados
 *  7.  DROPDOWN CUSTOMIZADO DE BANCOS (com busca e badge colorido)
 *  8.  TOAST AVISO (orçamento estourado)
 *  9.  POPUP COBRIR: usa saldo da reserva/meta para cobrir déficit
 *  10. POPUP ALTERAR SALÁRIO: aviso ao diminuir com depósito ativo
 *  11. UTILS: meses, anos, dropdowns, fmt, num, brl, pct
 *  12. SALVAR / CARREGAR MÊS no localStorage
 *  13. TROCA DE MÊS / ANO com animação
 *  14. RECALC GERAL: soma todos os blocos e atualiza painel direito
 *  15. RESERVA DE EMERGÊNCIA: saldo acumulado por movimentos
 *  16. POPUP MOVIMENTO (depositar / retirar)
 *  17. SISTEMA DE FILA DE TOASTS
 *  18. BARRA DE PROGRESSO DAS METAS
 *  19. MULTI-META: renderização em pilha, navegação, popup meta
 *  20. REPLICAR MÊS INTEIRO
 *  21. FECHAR / REABRIR MÊS (fechamento contábil)
 *  22. POPUP COBRIR DÉFICIT com reserva/meta
 *  23. CONFIGURAÇÕES (toggle de alerta de previsão)
 *  24. EXPORTAR / IMPORTAR dados em JSON
 *  25. PÁGINA DIÁRIO: tabela diária de gastos
 *  26. TOUR GUIADO
 *  27. SPLASH SCREEN
 *  28. SIMULADOR ANUAL DE RESERVA
 * ============================================================
 */

/* ── 1. MULTI-META: declarações globais ─────────────────────────────────
 *  O sistema suporta até 3 metas simultâneas.
 *  Cada meta é salva em uma chave separada do localStorage.
 *  _metaIdx: índice (0-2) da meta atualmente visível no card principal.
 * ────────────────────────────────────────────────────────────────────── */
const _META_KEYS = ["reserva_meta_v2", "reserva_meta_v2_b", "reserva_meta_v2_c"];
const _META_MAX  = 3;   // máximo de metas simultâneas
let   _metaIdx   = 0;   // índice da meta ativa no painel

/* ── 2. BOTÕES X NAS LINHAS ─────────────────────────────────────────────
 *  Cada linha do orçamento recebe 3 botões injetados via JS (não estão no HTML):
 *    • Subcategoria (tag): abre popup para nomear a despesa com mais detalhe
 *    • Replicar (⟳): copia esta linha para os próximos N meses
 *    • Limpar (×): apaga os campos da linha (com detecção de parcelas futuras)
 *  A função adicionarBotoesLimpar() é chamada no DOMContentLoaded e depois
 *  de qualquer operação que crie novas linhas.
 * ────────────────────────────────────────────────────────────────────── */
function atualizarLinhaPaga(linha) {
  const chk = linha.querySelector("input[type=checkbox]");
  if (chk) linha.classList.toggle("paga", chk.checked);
}

function adicionarBotoesLimpar() {
  document.querySelectorAll(".linha").forEach(_inicializarLinha);
}

// Lógica por-linha extraída de adicionarBotoesLimpar() para poder ser
// chamada isoladamente em linhas criadas dinamicamente (ex: padronização
// de 5 linhas no perfil único — ver _aplicarPerfilRenda), sem reprocessar
// (e duplicar o listener de checkbox em) todas as linhas já existentes.
function _inicializarLinha(linha) {
    // Atualiza estado paga ao mudar checkbox
    const chk = linha.querySelector("input[type=checkbox]");
    if (chk) {
      chk.addEventListener("change", () => { atualizarLinhaPaga(linha); recalc(); });
      atualizarLinhaPaga(linha);
    }
    if (linha.querySelector(".btn-limpar-linha")) return; // já tem

    // Botão subcategoria — em todas as linhas, no início
    const btnSub = document.createElement("button");
    btnSub.className = "btn-subcategoria-linha";
    const iconeSub = document.createElement("span");
    iconeSub.className = "icone-sub";
    iconeSub.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#aaa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7" stroke-width="3"/></svg>`;
    btnSub.appendChild(iconeSub);
    const tooltipSub = document.createElement("span");
    tooltipSub.className = "subcategoria-tooltip";
    btnSub._tooltipEl = tooltipSub;
    btnSub._iconeEl = iconeSub;
    tooltipSub.textContent = "Adicione uma subcategoria";
    btnSub.appendChild(tooltipSub);
    btnSub.addEventListener("click", () => abrirPopupSubcategoria(linha, btnSub));
    linha.insertBefore(btnSub, linha.firstChild);

    // Botão replicar (⟳)
    const btnRep = document.createElement("button");
    btnRep.className = "btn-replicar-linha";
    btnRep.title = "";
    btnRep.innerHTML = "⟳";
    const tooltip = document.createElement("span");
    tooltip.className = "replicar-tooltip";
    tooltip.textContent = "Replicar nos próximos meses";
    btnRep.appendChild(tooltip);
    btnRep.addEventListener("click", () => {
      const sel = linha.querySelector("select");
      const val = linha.querySelector(".val-input");
      const categoria = sel ? sel.value : "";
      const valor = val ? val.value : "";
      if (!categoria && !valor) {
        exibirToastSaldo("Preencha uma categoria e um valor antes de replicar.");
        return;
      }
      if (!categoria) {
        exibirToastSaldo("Preencha uma categoria antes de replicar.");
        return;
      }
      if (!valor) {
        exibirToastSaldo("Preencha um valor antes de replicar.");
        return;
      }
      abrirPopupReplicar(linha);
    });
    linha.appendChild(btnRep);

    // Botão limpar (×)
    const btn = document.createElement("button");
    btn.className = "btn-limpar-linha";
    btn.title = "";
    btn.textContent = "×";
    const tooltipLimpar = document.createElement("span");
    tooltipLimpar.className = "limpar-tooltip";
    tooltipLimpar.textContent = "Limpar linha";
    btn.appendChild(tooltipLimpar);
    btn.addEventListener("click", () => {
      const sel = linha.querySelector("select");
      const val = linha.querySelector(".val-input");
      const chk = linha.querySelector("input[type=checkbox]");

      const categoriaAtual = sel ? sel.value : "";
      const valorAtual = val ? val.value : "";
      const subAtual = linha._subcategoria || "";

      // Verifica se existem replicações nos próximos meses ANTES de limpar
      if (categoriaAtual && valorAtual) {
        const { bwIdx, lIdx } = getLinhaBlocoIndex(linha);
        if (bwIdx >= 0 && lIdx >= 0) {
          const parcelasEncontradas = detectarParcelasRestantes(bwIdx, lIdx, categoriaAtual, valorAtual, subAtual);
          if (parcelasEncontradas.length > 0) {
            // Guarda referência da linha no ctx para limpar depois da confirmação
            abrirPopupApagarParcelas(parcelasEncontradas, bwIdx, lIdx, categoriaAtual, valorAtual, subAtual, linha);
            return; // Não limpa ainda — aguarda decisão do usuário
          }
        }
      }

      // Sem replicações: limpa silenciosamente
      _limparLinha(linha, sel, val, chk);
    });
    linha.appendChild(btn);
}

/* ── REVERTER COBERTURA ─────────────────────────────────────────────────
 *  Quando o usuário limpa uma linha que causava déficit (e cuja cobertura
 *  já havia sido sacada da reserva/meta), o sistema devolve o valor
 *  de volta à reserva/meta automaticamente.
 *  _reverterCoberturaMes() → reverte tudo; _reverterCoberturaParcial(max)
 *  → reverte apenas até `max` reais.
 * ────────────────────────────────────────────────────────────────────── */

/* ── REVERTER COBERTURA ─────────────────────────────────────────────────
 *  Quando o usuário limpa uma linha que causava déficit e cuja cobertura
 *  já havia sido sacada da reserva/meta, o sistema devolve automaticamente.
 *  _reverterCoberturaMes() → reverte tudo;
 *  _reverterCoberturaParcial(max) → reverte apenas até `max` reais.
 * ────────────────────────────────────────────────────────────────────── */

/* ── APAGAR PARCELAS RESTANTES ── */
let _apagarParcelasCtx = null;

function _reverterCoberturaMes() {
  _reverterCoberturaParcial(Infinity); // reverte tudo
}

// Reverte até `valorMaximo` da cobertura ativa, na ordem: reserva primeiro, depois metas em ordem de slot
function _reverterCoberturaParcial(valorMaximo) {
  const chaveCobertura = "cobrir_valor_" + anoAtual + "_" + indice;
  const coberto = parseFloat(localStorage.getItem(chaveCobertura) || "0");
  if (coberto <= 0) return;

  let restante = Math.min(valorMaximo, coberto);
  if (restante <= 0.004) return;

  // Calcula saldo líquido de cobertura numa lista de movimentos
  // (saques de cobertura menos estornos já feitos)
  function saldoLiquidoCobertura(movs) {
    const sacado  = movs.filter(m => m.origem === "cobrir-deficit"        && m.ano === anoAtual && m.mes === indice).reduce((s, m) => s + m.valor, 0);
    const estorno = movs.filter(m => m.origem === "cobrir-deficit-estorno" && m.ano === anoAtual && m.mes === indice).reduce((s, m) => s + m.valor, 0);
    return Math.max(0, sacado - estorno);
  }

  // 1. Devolve para a reserva primeiro
  const reserva = carregarSaldoReserva();
  const liquReserva = saldoLiquidoCobertura(reserva.movimentos || []);

  if (liquReserva > 0.004 && restante > 0.004) {
    const devolver = Math.min(restante, liquReserva);
    reserva.movimentos = reserva.movimentos || [];

    if (Math.abs(devolver - liquReserva) < 0.005) {
      // Devolução total — remove todos os movimentos de cobertura e estorno da reserva
      reserva.movimentos = reserva.movimentos.filter(m =>
        m.origem !== "cobrir-deficit" && m.origem !== "cobrir-deficit-estorno" ||
        m.ano !== anoAtual || m.mes !== indice
      );
    } else {
      // Devolução parcial — registra estorno
      reserva.movimentos.push({ acao: "depositar", valor: devolver, data: new Date().toISOString(), mes: indice, ano: anoAtual, origem: "cobrir-deficit-estorno" });
    }

    reserva.saldo = calcularSaldoAteMes(reserva.movimentos, anoAtual, indice);
    salvarSaldoReserva(reserva);
    atualizarDisplayReserva();
    restante -= devolver;
  }

  // 2. Devolve para as metas em ordem de slot
  if (restante > 0.004) {
    _META_KEYS.forEach((chaveLS, slotIdx) => {
      if (restante <= 0.004) return;
      const meta = carregarDadosMeta(slotIdx);
      if (!meta) return;

      const liquMeta = saldoLiquidoCobertura(meta.movimentos || []);
      if (liquMeta <= 0.004) return;

      const devolver = Math.min(restante, liquMeta);
      meta.movimentos = meta.movimentos || [];

      if (Math.abs(devolver - liquMeta) < 0.005) {
        // Devolução total — remove cobertura e estornos desta meta
        meta.movimentos = meta.movimentos.filter(m =>
          m.origem !== "cobrir-deficit" && m.origem !== "cobrir-deficit-estorno" ||
          m.ano !== anoAtual || m.mes !== indice
        );
      } else {
        // Devolução parcial — registra estorno
        meta.movimentos.push({ acao: "depositar", valor: devolver, data: new Date().toISOString(), mes: indice, ano: anoAtual, origem: "cobrir-deficit-estorno" });
      }

      meta.saldoAcumulado = brl(calcularSaldoAteMes(meta.movimentos, anoAtual, indice));
      localStorage.setItem(chaveLS, JSON.stringify(meta));
      restante -= devolver;
    });
  }

  atualizarBarraReserva();

  const valorRevertido = Math.min(valorMaximo, coberto) - restante;

  // Desfaz o efeito no mov_previsao_ (o saque havia feito -valor via _aplicarRetiradaBloco,
  // então a reversão deve fazer +valorRevertido para neutralizar)
  if (valorRevertido > 0.004) {
    const chaveAdj = "mov_previsao_" + anoAtual + "_" + indice;
    const adjAtual = parseFloat(localStorage.getItem(chaveAdj) || "0");
    localStorage.setItem(chaveAdj, (adjAtual + valorRevertido).toFixed(2));

    // Desfaz proporcionalmente nos blocos
    const chaveBlocos = 'mov_previsao_blocos_' + anoAtual + '_' + indice;
    const rawBlocos = localStorage.getItem(chaveBlocos);
    if (rawBlocos) {
      const blocos = JSON.parse(rawBlocos);
      const totalRet = (blocos.retB1 || 0) + (blocos.retB2 || 0);
      if (totalRet > 0.004) {
        const propB1 = (blocos.retB1 || 0) / totalRet;
        const propB2 = (blocos.retB2 || 0) / totalRet;
        blocos.retB1 = Math.max(0, (blocos.retB1 || 0) - valorRevertido * propB1);
        blocos.retB2 = Math.max(0, (blocos.retB2 || 0) - valorRevertido * propB2);
        localStorage.setItem(chaveBlocos, JSON.stringify(blocos));
      }
    }
  }

  // Atualiza cobrir_valor com o saldo líquido restante de cobertura
  const novaCobertura = Math.max(0, coberto - (Math.min(valorMaximo, coberto) - restante));
  localStorage.setItem(chaveCobertura, novaCobertura.toFixed(2));
}

function _limparLinha(linha, sel, val, chk) {
  if (!sel) sel = linha.querySelector("select");
  if (!val) val = linha.querySelector(".val-input");
  if (!chk) chk = linha.querySelector("input[type=checkbox]");
  if (sel) sel.value = "";
  if (val) val.value = "";
  if (chk) chk.checked = false;
  if (sel && sel._customDisplay) {
    const display = sel._customDisplay;
    const clearBtn = display._clearBtn;
    display.childNodes.forEach(n => { if (n !== clearBtn) n.remove(); });
    display.insertBefore(document.createTextNode("Selecione"), display.firstChild);
    aplicarCorBancoDisplay(display, "");
    atualizarDisplayVazio(display, "");
    if (clearBtn) clearBtn.classList.remove("visible");
  }
  linha._subcategoria = "";
  const btnSub = linha.querySelector(".btn-subcategoria-linha");
  if (btnSub) atualizarTooltipSubcategoria(btnSub, linha);
  _reverterCoberturaMes();
  recalc();
}

function detectarParcelasRestantes(bwIdx, lIdx, categoriaVal, valorVal, subVal) {
  // Varre os próximos 11 meses no localStorage em busca de cópias idênticas desta linha.
  // Retorna array de { p, mesIdx, anoIdx, nomeMes } para exibir no popup de confirmação.
  const encontradas = [];
  for (let p = 1; p <= 11; p++) {
    const totalMes = indice + p;
    const mesAlvoIdx = totalMes % 12;
    const anoAlvo = anoAtual + Math.floor(totalMes / 12);
    // Chave no localStorage: "planejamento_ano_mes" — aba chamada "Mensal" na UI
    const chave = "planejamento_" + anoAlvo + "_" + mesAlvoIdx;
    const raw = localStorage.getItem(chave);
    if (!raw) continue;
    let dados = {};
    try { dados = JSON.parse(raw); } catch(e) { continue; }

    const k = `bw${bwIdx}_l${lIdx}`;
    const selVal = dados[k + "_sel"] || "";
    const valVal = dados[k + "_val"] || "";
    const subExist = (dados[k + "_sub"] || "").trim();
    const subNova = (subVal || "").trim();

    if (selVal !== categoriaVal || selVal === "") continue;
    if (valVal !== valorVal) continue;
    // Subcategoria deve bater (ou ambas vazias)
    if (subNova !== subExist) continue;

    encontradas.push({ p, mesIdx: mesAlvoIdx, anoIdx: anoAlvo, nomeMes: meses[mesAlvoIdx] });
  }
  return encontradas;
}

function abrirPopupApagarParcelas(parcelas, bwIdx, lIdx, categoriaVal, valorVal, subVal, linhaRef) {
  const _x_popup_apagar_parcelas = document.getElementById("x-popup-apagar-parcelas"); if (_x_popup_apagar_parcelas) _x_popup_apagar_parcelas.style.display = "flex";
  _apagarParcelasCtx = { parcelas, bwIdx, lIdx, categoriaVal, valorVal, subVal, linhaRef };

  const nomeExibido = subVal ? `${categoriaVal} (${subVal})` : categoriaVal;
  const qtd = parcelas.length;
  document.getElementById("apagar-parcelas-descricao").innerHTML =
    `Este gasto (<strong>${nomeExibido}</strong> — <strong>${valorVal}</strong>) foi replicado em <strong>${qtd} ${qtd === 1 ? "mês" : "meses"}</strong>. O que deseja fazer com as cópias?`;

  const lista = parcelas.map(c => `<li><strong>${c.nomeMes}</strong></li>`).join("");
  document.getElementById("apagar-parcelas-lista").innerHTML = lista;

  const overlay = document.getElementById("popup-apagar-parcelas-overlay");
  const popup   = document.getElementById("popup-apagar-parcelas");
  overlay.style.display = "block";
  popup.style.display = "block";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.style.opacity = "1";
    popup.style.transform = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "all";
  }));
}

function fecharPopupApagarParcelas() {
  const _x_popup_apagar_parcelas = document.getElementById("x-popup-apagar-parcelas"); if (_x_popup_apagar_parcelas) _x_popup_apagar_parcelas.style.display = "none";
  const overlay = document.getElementById("popup-apagar-parcelas-overlay");
  const popup   = document.getElementById("popup-apagar-parcelas");
  if (overlay) overlay.style.display = "none";
  if (popup) {
    popup.style.opacity = "0";
    popup.style.transform = "translate(-50%,-50%) scale(0.92)";
    popup.style.pointerEvents = "none";
    setTimeout(() => { popup.style.display = "none"; }, 220);
  }
  _apagarParcelasCtx = null;
}

function resolverApagarParcelas(apagar) {
  if (!_apagarParcelasCtx) return;
  const { parcelas, bwIdx, lIdx, linhaRef } = _apagarParcelasCtx;

  // Limpa a linha do mês atual agora que o usuário decidiu
  if (linhaRef) _limparLinha(linhaRef, null, null, null);

  if (apagar) {
    parcelas.forEach(({ mesIdx, anoIdx }) => {
      const chave = "planejamento_" + (anoIdx || anoAtual) + "_" + mesIdx;
      const raw = localStorage.getItem(chave);
      if (!raw) return;
      let dados = {};
      try { dados = JSON.parse(raw); } catch(e) { return; }
      const k = `bw${bwIdx}_l${lIdx}`;
      dados[k + "_sel"] = "";
      dados[k + "_val"] = "";
      dados[k + "_chk"] = false;
      dados[k + "_sub"] = "";
      localStorage.setItem(chave, JSON.stringify(dados));
    });

    const qtd = parcelas.length;
    const feedbackEl = document.createElement("div");
    feedbackEl.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#c0392b,#e74c3c);color:#fff;padding:12px 24px;border-radius:10px;font-size:13px;font-weight:700;box-shadow:0 4px 20px rgba(192,57,43,0.4);z-index:99999;white-space:nowrap;";
    feedbackEl.textContent = "Gasto removido de " + qtd + (qtd === 1 ? " mês." : " meses.");
    document.body.appendChild(feedbackEl);
    setTimeout(() => feedbackEl.remove(), 2800);
  }
  fecharPopupApagarParcelas();
}

/* ── 3. SUBCATEGORIA ───────────────────────────────────────────────────
 *  Cada linha pode ter uma "subcategoria" — um texto livre que detalha
 *  a despesa (ex: "Financiamento da moto", "Plano família").
 *  É salvo em linha._subcategoria (propriedade JS no elemento DOM)
 *  e persistido junto com os demais dados da linha no localStorage.
 *  O ícone de tag na linha fica colorido quando há subcategoria.
 * ────────────────────────────────────────────────────────────────────── */
/* ── SUBCATEGORIA ──────────────────────────────────────────────────────
 *  Cada linha pode ter uma "subcategoria" — texto livre que detalha a
 *  despesa (ex: "Financiamento da moto"). Salvo em linha._subcategoria
 *  e persistido no localStorage. O ícone de tag fica colorido com a cor
 *  do banco quando há subcategoria.
 * ────────────────────────────────────────────────────────────────────── */
/* ── SUBCATEGORIA ── */
let _subcategoriaLinha = null;
let _subcategoriaBtnRef = null;

function atualizarTooltipSubcategoria(btn, linha) {
  const sub = linha._subcategoria || "";
  if (btn._tooltipEl) {
    btn._tooltipEl.textContent = sub ? sub : "Adicione subcategoria";
  }
  const iconeEl = btn._iconeEl || btn.querySelector(".icone-sub");

  if (sub) {
    btn.classList.add("tem-sub");
    // Herda a cor da categoria selecionada na linha
    const sel = linha.querySelector("select");
    const categoria = sel ? sel.value : "";
    const cor = coresBancos[categoria];
    const bgCor  = cor ? cor.bg  : "#3a6edc";
    const txtCor = cor ? cor.color : "#fff";
    if (iconeEl) {
      iconeEl.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="${bgCor}55" stroke="${bgCor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7" stroke-width="3"/></svg>`;
      iconeEl.style.filter = "";
    }
    btn.style.background = "";
    btn.style.boxShadow = "";
  } else {
    btn.classList.remove("tem-sub");
    if (iconeEl) {
      iconeEl.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#aaa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7" stroke-width="3"/></svg>`;
      iconeEl.style.filter = "";
    }
    btn.style.background = "";
    btn.style.boxShadow = "";
  }
}

function abrirPopupSubcategoria(linha, btnRef) {
  const _x_popup_subcategoria = document.getElementById("x-popup-subcategoria"); if (_x_popup_subcategoria) _x_popup_subcategoria.style.display = "flex";
  _subcategoriaLinha = linha;
  _subcategoriaBtnRef = btnRef;

  const sel = linha.querySelector("select");
  const categoria = sel ? sel.value : "";
  const sub = linha._subcategoria || "";

  const badge = document.getElementById("subcategoria-badge");
  badge.textContent = categoria;
  badge.style.display = categoria ? "inline-block" : "none";
  const corBadge = coresBancos[categoria];
  badge.style.background = corBadge ? corBadge.bg : "#215a6c";
  badge.style.color      = corBadge ? corBadge.color : "#fff";
  document.getElementById("subcategoria-input").value = sub;
  document.getElementById("btn-subcategoria-limpar").style.display = sub ? "block" : "none";

  const overlay = document.getElementById("popup-subcategoria-overlay");
  const popup   = document.getElementById("popup-subcategoria");
  overlay.classList.add("visivel");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.classList.add("visivel");
    setTimeout(() => {
      const inp = document.getElementById("subcategoria-input");
      inp.focus();
      inp.onkeydown = (e) => { if (e.key === "Enter") confirmarSubcategoria(); };
    }, 150);
  }));
}

function fecharPopupSubcategoria() {
  // Durante o tour, o popup é controlado pelo onSair do passo — não faz nada aqui
  if (document.body.classList.contains('tour-ativo')) return;
  const _x_popup_subcategoria = document.getElementById("x-popup-subcategoria"); if (_x_popup_subcategoria) _x_popup_subcategoria.style.display = "none";
  document.getElementById("popup-subcategoria-overlay").classList.remove("visivel");
  document.getElementById("popup-subcategoria").classList.remove("visivel");
  _subcategoriaLinha = null;
  _subcategoriaBtnRef = null;
}

function confirmarSubcategoria() {
  if (!_subcategoriaLinha) return;
  const val = document.getElementById("subcategoria-input").value.trim();
  if (!val) { fecharPopupSubcategoria(); return; }

  // Verifica se já existe a mesma subcategoria em outra linha
  const subNova = val.toLowerCase();
  const todasLinhas = document.querySelectorAll(".linha");
  for (const outra of todasLinhas) {
    if (outra === _subcategoriaLinha) continue;
    const outSub = (outra._subcategoria || "").trim().toLowerCase();
    if (outSub === subNova) {
      exibirToastSaldo("Já existe um lançamento com essa subcategoria. Use um nome diferente.");
      return;
    }
  }

  _subcategoriaLinha._subcategoria = val;
  if (_subcategoriaBtnRef) atualizarTooltipSubcategoria(_subcategoriaBtnRef, _subcategoriaLinha);
  salvarMes();
  fecharPopupSubcategoria();
}

function limparSubcategoria() {
  if (!_subcategoriaLinha) return;
  _subcategoriaLinha._subcategoria = "";
  if (_subcategoriaBtnRef) atualizarTooltipSubcategoria(_subcategoriaBtnRef, _subcategoriaLinha);
  salvarMes();
  fecharPopupSubcategoria();
}

/* ── 4. REPLICAR NOS PRÓXIMOS MESES ────────────────────────────────────
 *  O botão ⟳ em cada linha abre um popup para selecionar quantos meses
 *  à frente essa despesa deve ser repetida (1x a 6x, ou digitado manualmente).
 *  O sistema detecta:
 *    • Conflito de mesma linha (já existe — avisa, mas prossegue)
 *    • Conflito em outra linha (possível duplicata — pede confirmação)
 *  Os dados são gravados diretamente no localStorage de cada mês-alvo.
 * ────────────────────────────────────────────────────────────────────── */
/* ── REPLICAR NOS PRÓXIMOS MESES ───────────────────────────────────────
 *  O botão ⟳ em cada linha replica a despesa para N meses à frente.
 *  O sistema detecta conflitos (mesma categoria+valor em outra linha)
 *  e pede confirmação antes de sobrescrever ou adicionar em paralelo.
 * ────────────────────────────────────────────────────────────────────── */
/* ── REPLICAR NOS PRÓXIMOS MESES ── */
let _replicarLinha = null;
let _replicarParcelas = 0;

function getLinhaBlocoIndex(linha) {
  // Mapeia um elemento .linha DOM para os índices bwIdx (bloco-wrap) e lIdx (linha dentro do bloco).
  // Usados como chave no localStorage: bw0_l2_sel, bw0_l2_val etc.
  // Retorna { bwIdx, lIdx } para identificar a linha no localStorage
  let bwIdx = -1, lIdx = -1;
  document.querySelectorAll(".bloco-wrap").forEach((bw, bi) => {
    bw.querySelectorAll(".linha").forEach((l, li) => {
      if (l === linha) { bwIdx = bi; lIdx = li; }
    });
  });
  return { bwIdx, lIdx };
}

function stepParcela(id, delta) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const min = parseInt(inp.min) || 1;
  const max = parseInt(inp.max) || 120;
  const val = parseInt(inp.value) || 0;
  inp.value = Math.min(max, Math.max(min, val + delta));
  inp.dispatchEvent(new Event('input'));
}

function abrirPopupReplicar(linha) {
  const _x_popup_replicar = document.getElementById("x-popup-replicar"); if (_x_popup_replicar) _x_popup_replicar.style.display = "flex";
  _replicarLinha = linha;
  _replicarParcelas = 0;

  // Pegar info da linha
  const sel = linha.querySelector("select");
  const val = linha.querySelector(".val-input");
  const banco = sel ? sel.value : "";
  const valor = val ? val.value : "";

  const bancoTxt = banco || "—";
  const valorTxt = valor || "R$ 0,00";
  const subTxt = _replicarLinha._subcategoria ? `<br><strong>Subcategoria:</strong> ${_replicarLinha._subcategoria}` : "";

  document.getElementById("replicar-preview-info").innerHTML =
    `<strong>Categoria:</strong> ${bancoTxt}<br><strong>Valor:</strong> ${valorTxt}${subTxt}`;

  // Gerar botões de parcelas (2x a 12x)
  const grid = document.getElementById("parcelas-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= 6; i++) {
    const b = document.createElement("button");
    b.className = "parcela-btn";
    b.textContent = i + "x";
    b.dataset.parcelas = i;
    b.addEventListener("click", () => {
      document.querySelectorAll(".parcela-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _replicarParcelas = i;
      document.getElementById("parcela-custom-input").value = "";
      verificarAviso();
    });
    grid.appendChild(b);
  }

  document.getElementById("parcela-custom-input").value = "";
  document.getElementById("parcela-custom-input").oninput = function() {
    const v = parseInt(this.value);
    if (v >= 1) {
      _replicarParcelas = v;
      document.querySelectorAll(".parcela-btn").forEach(x => x.classList.remove("ativo"));
    }
    verificarAviso();
  };

  const overlay = document.getElementById("popup-replicar-overlay");
  const popup = document.getElementById("popup-replicar");

  // Clique no fundo do popup (fora dos botões) desmarca seleção
  popup.addEventListener("click", function(e) {
    if (!e.target.closest(".parcela-btn") && !e.target.closest(".parcela-custom-input")) {
      document.querySelectorAll(".parcela-btn").forEach(x => x.classList.remove("ativo"));
      if (_replicarParcelas > 0 && !document.getElementById("parcela-custom-input").value) {
        _replicarParcelas = 0;
      }
    }
  }, { capture: false });

  overlay.classList.add("visivel");
  requestAnimationFrame(() => requestAnimationFrame(() => popup.classList.add("visivel")));
}

function verificarAviso() {
  const infoEl = document.getElementById("replicar-info");
  if (!infoEl || !_replicarLinha || _replicarParcelas < 2) {
    if (infoEl) infoEl.style.display = "none";
    return;
  }

  const { bwIdx, lIdx } = getLinhaBlocoIndex(_replicarLinha);
  if (bwIdx < 0 || lIdx < 0) return;

  const sel = _replicarLinha.querySelector("select");
  const val = _replicarLinha.querySelector(".val-input");
  const bancoVal = sel ? sel.value : "";
  const valorVal = val ? val.value : "";
  const subVal   = _replicarLinha._subcategoria || "";

  if (!bancoVal || !valorVal) { infoEl.style.display = "none"; return; }

  const mesesParaReplicar = _replicarParcelas;
  const todosConflitos = detectarConflitos(bwIdx, bancoVal, subVal, mesesParaReplicar, valorVal);
  const mesmaLinha = todosConflitos.filter(c => c.li === lIdx);

  if (mesmaLinha.length === 0) { infoEl.style.display = "none"; return; }

  const novos = mesesParaReplicar - mesmaLinha.length;
  if (novos === 0) {
    infoEl.textContent = mesmaLinha.length === 1
      ? "Este gasto já existe no mês seguinte."
      : `Este gasto já existe nos próximos ${mesmaLinha.length} meses.`;
  } else {
    const jaExiste = mesmaLinha.length === 1
      ? "no mês seguinte"
      : `nos próximos ${mesmaLinha.length} meses`;
    infoEl.textContent = `Este gasto já existe ${jaExiste}. Será adicionado ${novos === 1 ? "no 1 mês restante" : `nos ${novos} meses restantes`}.`;
  }
  infoEl.style.display = "block";
}

function fecharPopupReplicar() {
  const _x_popup_replicar = document.getElementById("x-popup-replicar"); if (_x_popup_replicar) _x_popup_replicar.style.display = "none";
  document.getElementById("popup-replicar-overlay").classList.remove("visivel");
  document.getElementById("popup-replicar").classList.remove("visivel");
  const erroEl = document.getElementById("replicar-erro");
  if (erroEl) erroEl.style.display = "none";
  const infoEl = document.getElementById("replicar-info");
  if (infoEl) infoEl.style.display = "none";
  _replicarLinha = null;
  _replicarParcelas = 0;
}

/* Verifica conflitos ao replicar:
   - Se ambas têm subcategoria: conflito quando subcategoria E categoria são iguais
   - Se nenhuma tem subcategoria: conflito apenas quando o VALOR for igual (possível duplicata)
   - Se só uma tem subcategoria: não é conflito (são entradas distintas)
*/
function detectarConflitos(bwIdx, bancoVal, subVal, mesesParaReplicar, valorVal) {
  const conflitos = [];
  for (let p = 1; p <= mesesParaReplicar; p++) {
    const totalMes2 = indice + p;
    const mesAlvoIdx = totalMes2 % 12;
    const anoAlvo2 = anoAtual + Math.floor(totalMes2 / 12);
    const chave = "planejamento_" + anoAlvo2 + "_" + mesAlvoIdx;
    const raw = localStorage.getItem(chave);
    if (!raw) continue;
    let dados = {};
    try { dados = JSON.parse(raw); } catch(e) { continue; }

    let encontrado = null;
    const totalLinhas = document.querySelectorAll(".bloco-wrap")[bwIdx]?.querySelectorAll(".linha").length || 0;
    for (let li = 0; li < totalLinhas; li++) {
      const k = `bw${bwIdx}_l${li}`;
      const selVal = dados[k + "_sel"] || "";
      const valVal = dados[k + "_val"] || "";
      const subExistente = (dados[k + "_sub"] || "").trim();
      const subNova = (subVal || "").trim();

      if (selVal === "" || selVal !== bancoVal) continue;


      let ehConflito = false;
      if (subNova !== "" && subExistente !== "") {
        // Ambas têm sub: só avisa se sub E valor forem iguais
        ehConflito = subExistente.toLowerCase() === subNova.toLowerCase() && valVal === valorVal;
      } else {
        // Uma ou nenhuma tem sub: avisa se valor for igual
        ehConflito = valVal !== "" && valVal === valorVal;
      }

      if (ehConflito) {
        encontrado = { li, valor: valVal, sub: dados[k + "_sub"] || "" };
        break;
      }
    }
    if (encontrado) {
      conflitos.push({ p, mesIdx: mesAlvoIdx, nomeMes: meses[mesAlvoIdx], li: encontrado.li, valor: encontrado.valor, sub: encontrado.sub });
    }
  }
  return conflitos;
}

function confirmarReplicar() {
  const erroEl = document.getElementById("replicar-erro");

  if (!_replicarLinha || _replicarParcelas < 1) {
    exibirToastSaldo("Preencha uma categoria, um valor e selecione a quantidade de parcelas para replicar.");
    return;
  }

  const { bwIdx, lIdx } = getLinhaBlocoIndex(_replicarLinha);
  if (bwIdx < 0 || lIdx < 0) { fecharPopupReplicar(); return; }

  const sel = _replicarLinha.querySelector("select");
  const val = _replicarLinha.querySelector(".val-input");
  const chk = _replicarLinha.querySelector("input[type=checkbox]");
  const bancoVal = sel ? sel.value : "";
  const valorVal = val ? val.value : "";
  const chkVal   = chk ? chk.checked : false;
  const subVal   = _replicarLinha._subcategoria || "";

  // Bloqueia se não houver valor preenchido
  if (!valorVal) {
    exibirToastSaldo("Preencha uma categoria e um valor antes de replicar.");
    return;
  }

  if (erroEl) erroEl.style.display = "none";

  salvarMes();

  const mesesParaReplicar = _replicarParcelas;

  // Detecta conflitos se tiver categoria OU valor preenchido
  const conflitos = bancoVal ? detectarConflitos(bwIdx, bancoVal, subVal, mesesParaReplicar, valorVal) : [];

  // Separa conflitos da mesma linha (replicação anterior) de linhas diferentes (duplicata real)
  const conflitosMesmaLinha = conflitos.filter(c => c.li === lIdx);
  const conflitosOutrasLinhas = conflitos.filter(c => c.li !== lIdx);

  if (conflitosOutrasLinhas.length > 0) {
    // Duplicata real — abre popup de conflito
    document.getElementById("popup-replicar-overlay").classList.remove("visivel");
    document.getElementById("popup-replicar").classList.remove("visivel");
    abrirPopupConflito(conflitosOutrasLinhas, bwIdx, lIdx, bancoVal, valorVal, chkVal, subVal, mesesParaReplicar);
  } else {
    // Mesma linha ou sem conflitos — executa normalmente
    // Se todos os meses já têm o gasto, não faz nada
    if (conflitosMesmaLinha.length === mesesParaReplicar) {
      fecharPopupReplicar();
      return;
    }
    fecharPopupReplicar();
    executarReplicar(bwIdx, lIdx, bancoVal, valorVal, chkVal, subVal, mesesParaReplicar, "sobrescrever");
  }
}

function executarReplicar(bwIdx, lIdx, bancoVal, valorVal, chkVal, subVal, mesesParaReplicar, modoConflito, conflitos) {
  conflitos = conflitos || [];
  const conflitosIdx = new Set(conflitos.map(c => c.p));


  for (let p = 1; p <= mesesParaReplicar; p++) {
    const totalMes3 = indice + p;
    const mesAlvoIdx = totalMes3 % 12;
    const anoAlvo3 = anoAtual + Math.floor(totalMes3 / 12);
    const chave = "planejamento_" + anoAlvo3 + "_" + mesAlvoIdx;
    let dados = {};
    const raw = localStorage.getItem(chave);
    if (raw) { try { dados = JSON.parse(raw); } catch(e) {} }

    const k = `bw${bwIdx}_l${lIdx}`;


    if (conflitosIdx.has(p) && modoConflito === "adicionar") {
      const totalLinhas = document.querySelectorAll(".bloco-wrap")[bwIdx]?.querySelectorAll(".linha").length || 0;
      let inserido = false;
      for (let li = 0; li < totalLinhas; li++) {
        const kl = `bw${bwIdx}_l${li}`;
        if (!dados[kl + "_sel"] && !dados[kl + "_val"]) {
          dados[kl + "_sel"] = bancoVal;
          dados[kl + "_val"] = valorVal;
          dados[kl + "_chk"] = chkVal;
          dados[kl + "_sub"] = subVal;
          inserido = true;
          break;
        }
      }
      if (!inserido) {
        dados[k + "_sel"] = bancoVal;
        dados[k + "_val"] = valorVal;
        dados[k + "_chk"] = chkVal;
        dados[k + "_sub"] = subVal;
      }
    } else {
      dados[k + "_sel"] = bancoVal;
      dados[k + "_val"] = valorVal;
      dados[k + "_chk"] = chkVal;
      dados[k + "_sub"] = subVal;
    }

    localStorage.setItem(chave, JSON.stringify(dados));
  }

  fecharPopupReplicar();
  fecharPopupConflito();

  const feedbackEl = document.createElement("div");
  feedbackEl.style.cssText = `
    position:fixed; bottom:28px; left:50%; transform:translateX(-50%);
    background:linear-gradient(135deg,#1c3f91,#3a6edc); color:#fff;
    padding:12px 24px; border-radius:10px; font-size:13px; font-weight:700;
    box-shadow:0 4px 20px rgba(58,110,220,0.4); z-index:99999;
    animation: fadeInUp 0.3s ease;
  `;
  feedbackEl.textContent = `✓ Replicado em ${mesesParaReplicar} ${mesesParaReplicar === 1 ? "mês seguinte" : "meses seguintes"}!`;
  document.body.appendChild(feedbackEl);
  setTimeout(() => feedbackEl.remove(), 2800);
}

/* ── 5. POPUP DE CONFLITO ──────────────────────────────────────────────
 *  Exibido quando o usuário tenta replicar uma linha e há outra linha
 *  num mês futuro com a mesma categoria E valor (possível duplicata).
 *  O usuário escolhe: "Adicionar" (mantém ambas) ou "Substituir" (sobrescreve).
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP DE CONFLITO ─────────────────────────────────────────────────
 *  Exibido quando há possível duplicata ao replicar.
 *  Opções: "Adicionar" (mantém ambas) ou "Substituir" (sobrescreve).
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP DE CONFLITO ── */
let _conflitoCtx = null;

function abrirPopupConflito(conflitos, bwIdx, lIdx, bancoVal, valorVal, chkVal, subVal, mesesParaReplicar) {
  const _x_popup_conflito = document.getElementById("x-popup-conflito"); if (_x_popup_conflito) _x_popup_conflito.style.display = "flex";
  _conflitoCtx = { conflitos, bwIdx, lIdx, bancoVal, valorVal, chkVal, subVal, mesesParaReplicar };

  const listaMeses = conflitos.map(c => {
    const valorFmt = c.valor || "R$ 0,00";
    const subTxt = c.sub
      ? ` &nbsp;<span style="color:#3a6edc;font-size:10px;font-style:italic;">● ${c.sub}</span>`
      : "";
    return `<li><strong>${c.nomeMes}:</strong> ${bancoVal}${subTxt} — <strong>${valorFmt}</strong></li>`;
  }).join("");

  document.getElementById("conflito-lista").innerHTML = listaMeses;
  document.getElementById("conflito-novo-valor").textContent = valorVal || "R$ 0,00";

  // Mensagem contextual
  const descEl = document.getElementById("conflito-descricao");
  const subExistente = conflitos[0]?.sub || "";
  if (subVal && subExistente) {
    descEl.innerHTML = `Você já possui <strong>${bancoVal}</strong> com a subcategoria <strong>${subExistente}</strong> e o mesmo valor nos meses abaixo. Deseja continuar mesmo assim?`;
  } else if (!subVal && subExistente) {
    descEl.innerHTML = `Você já possui <strong>${bancoVal}</strong> com a subcategoria <strong>${subExistente}</strong> e o mesmo valor nos meses abaixo. Trata-se da mesma despesa?`;
  } else if (subVal && !subExistente) {
    descEl.innerHTML = `Você já possui <strong>${bancoVal}</strong> com o mesmo valor nos meses abaixo. Deseja adicionar <strong>${subVal}</strong> como entrada separada?`;
  } else {
    descEl.innerHTML = `Você já possui <strong>${bancoVal}</strong> com o mesmo valor nos meses abaixo. Está repetindo ou é uma entrada diferente?`;
  }

  const overlay = document.getElementById("popup-conflito-overlay");
  const popup   = document.getElementById("popup-conflito");
  overlay.style.display = "block";
  popup.style.display = "block";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.style.opacity = "1";
    popup.style.transform = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "all";
  }));
}

function fecharPopupConflito() {
  const _x_popup_conflito = document.getElementById("x-popup-conflito"); if (_x_popup_conflito) _x_popup_conflito.style.display = "none";
  const overlay = document.getElementById("popup-conflito-overlay");
  const popup   = document.getElementById("popup-conflito");
  if (overlay) overlay.style.display = "none";
  if (popup) {
    popup.style.opacity = "0";
    popup.style.transform = "translate(-50%,-50%) scale(0.92)";
    popup.style.pointerEvents = "none";
    setTimeout(() => { popup.style.display = "none"; }, 220);
  }
  _conflitoCtx = null;
}

function resolverConflito(modo) {
  if (!_conflitoCtx) return;
  const { conflitos, bwIdx, lIdx, bancoVal, valorVal, chkVal, subVal, mesesParaReplicar } = _conflitoCtx;
  executarReplicar(bwIdx, lIdx, bancoVal, valorVal, chkVal, subVal, mesesParaReplicar, modo, conflitos);
}

/* ── 6. CORES DOS BANCOS ───────────────────────────────────────────────
 *  Mapa de cor de fundo e cor de texto para cada banco/categoria.
 *  Usado para colorir o select customizado quando uma opção é escolhida.
 *  Categorias de residência (Internet, Água etc.) usam azul-petróleo (#215a6c).
 * ────────────────────────────────────────────────────────────────────── */
/* ── CORES DOS BANCOS ───────────────────────────────────────────────────
 *  Mapa banco → { bg, color } para colorir o select customizado.
 *  Categorias de residência (Internet, Água etc.) = azul-petróleo #215a6c.
 * ────────────────────────────────────────────────────────────────────── */
/* ── CORES DOS BANCOS NOS SELECTS DE CARTÃO ── */

/* ══════════════════════════════════════════════════════════════════════
 *  CATEGORIAS PERSONALIZADAS
 *  - Tipo 'residencia': aparece nos blocos res (bloco1-res, bloco2-res)
 *  - Tipo 'cartoes': aparece nos blocos cart (bloco1-cart, bloco2-cart)
 *  - Tipo 'outros': aparece nos blocos emp (bloco1-emp, bloco2-emp)
 *  - Máximo 5 por tipo (15 no total)
 *  - Salvo em localStorage 'categorias_personalizadas' e exportado no JSON
 * ══════════════════════════════════════════════════════════════════════ */

const CAT_MAX = 5;
const CAT_LS_KEY = 'categorias_personalizadas';

function _catCarregar() {
  try {
    const dados = JSON.parse(localStorage.getItem(CAT_LS_KEY) || '{}');
    if (!Array.isArray(dados.residencia)) dados.residencia = [];
    // Migração: versões antigas usavam 'geral' para cartões+outros → move para 'cartoes'
    if (!Array.isArray(dados.cartoes)) dados.cartoes = Array.isArray(dados.geral) ? dados.geral : [];
    if (!Array.isArray(dados.outros))  dados.outros  = [];
    delete dados.geral;
    return dados;
  }
  catch(e) { return { residencia: [], cartoes: [], outros: [] }; }
}
function _catSalvar(dados) {
  localStorage.setItem(CAT_LS_KEY, JSON.stringify(dados));
}

// Retorna o tipo com base no bloco-wrap mais próximo de um select
function _catTipoPorBloco(blocoTitulo) {
  if (blocoTitulo.includes('resid')) return 'residencia';
  if (blocoTitulo.includes('cart'))  return 'cartoes';
  return 'outros';
}

// Mescla categorias personalizadas no coresBancos e nas listas de opções
function _catAplicar() {
  const dados = _catCarregar();

  // Remove entradas personalizadas antigas antes de re-adicionar
  Object.keys(coresBancos).forEach(k => { if (coresBancos[k]._custom) delete coresBancos[k]; });

  // Remove itens personalizados das listas (trunca ao tamanho padrão)
  while (bancosResidencia.length > _CAT_RES_PADRAO)    bancosResidencia.pop();
  while (bancosCartao.length     > _CAT_CART_PADRAO)   bancosCartao.pop();
  while (bancosOutros.length     > _CAT_OUTROS_PADRAO) bancosOutros.pop();

  dados.residencia.forEach(cat => {
    coresBancos[cat.nome] = { bg: cat.bg, color: cat.color, _custom: true };
    if (!bancosResidencia.includes(cat.nome)) bancosResidencia.push(cat.nome);
  });
  dados.cartoes.forEach(cat => {
    coresBancos[cat.nome] = { bg: cat.bg, color: cat.color, _custom: true };
    if (!bancosCartao.includes(cat.nome)) bancosCartao.push(cat.nome);
  });
  dados.outros.forEach(cat => {
    coresBancos[cat.nome] = { bg: cat.bg, color: cat.color, _custom: true };
    if (!bancosOutros.includes(cat.nome)) bancosOutros.push(cat.nome);
  });

  // Injeta <option> nos selects nativos para que sel.value funcione ao restaurar o mes
  document.querySelectorAll(".bloco-wrap").forEach(bw => {
    const titulo = bw.querySelector("h3")?.textContent.trim().toLowerCase() || "";
    const tipo = _catTipoPorBloco(titulo);
    const cats = dados[tipo] || [];
    bw.querySelectorAll("select").forEach(sel => {
      sel.querySelectorAll("option[data-custom]").forEach(o => o.remove());
      cats.forEach(cat => {
        if (!sel.querySelector('option[value="' + cat.nome + '"]')) {
          const opt = document.createElement("option");
          opt.value = cat.nome;
          opt.textContent = cat.nome;
          opt.setAttribute("data-custom", "1");
          sel.appendChild(opt);
        }
      });
    });
  });
}

// Reconstrói os itens do dropdown após adicionar categoria
function _catAtualizarDropdowns(tipo) {
  document.querySelectorAll('.bloco-wrap').forEach(bw => {
    const titulo = bw.querySelector('h3')?.textContent.trim().toLowerCase() || '';
    const tipoBloco = _catTipoPorBloco(titulo);
    if (tipoBloco !== tipo) return;
    bw.querySelectorAll('select').forEach(sel => {
      const display = sel._customDisplay;
      if (!display) return;
      const list = display._list;
      if (!list) return;
      // Remove itens antigos (mantém search)
      list.querySelectorAll('.select-banco-item').forEach(i => i.remove());
      const lista = tipo === 'residencia' ? bancosResidencia : tipo === 'cartoes' ? bancosCartao : bancosOutros;
      lista.forEach(banco => {
        if (banco === 'Selecione') return;
        const item = document.createElement('div');
        item.className = 'select-banco-item';
        item.textContent = banco;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          sel.value = banco;
          display.textContent = banco;
          display.appendChild(display._clearBtn);
          aplicarCorBancoDisplay(display, banco);
          atualizarDisplayVazio(display, banco);
          display._clearBtn.classList.add('visible');
          list.classList.remove('open');
          const linha = sel.closest('.linha');
          if (linha) {
            const btnSub = linha.querySelector('.btn-subcategoria-linha');
            if (btnSub) atualizarTooltipSubcategoria(btnSub, linha);
          }
          recalc();
        });
        list.appendChild(item);
      });
      // Adiciona botão lápis ao final da lista
      _catInjetarLapis(list, tipo);
    });
  });
}

// Injeta o botão lápis no final da lista dropdown
function _catInjetarLapis(list, tipo) {
  list.querySelectorAll('.select-banco-editar-cat').forEach(e => e.remove());
  const footer = document.createElement('div');
  footer.className = 'select-banco-editar-cat';
  const btn = document.createElement('button');
  btn.className = 'select-banco-lapis-btn';
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span class="lapis-tooltip">Editar categorias</span>';
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    list.classList.remove('open');
    abrirPopupCategorias(tipo);
  });
  footer.appendChild(btn);
  list.appendChild(footer);
}

/* ── Popup de gerenciar categorias ── */
let _catTipoAtual = 'residencia';
let _catEditandoIdx = -1; // -1 = novo

function abrirPopupCategorias(tipo) {
  _catTipoAtual = tipo;
  _catEditandoIdx = -1;
  const overlay = document.getElementById('popup-categorias-overlay');
  const popup   = document.getElementById('popup-categorias');
  const subtitulos = { residencia: 'Residência', cartoes: 'Cartões', outros: 'Outros' };
  document.getElementById('popup-cat-subtitulo').textContent = subtitulos[tipo] || tipo;
  overlay.style.display = 'block';
  popup.style.display   = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.style.opacity       = '1';
    popup.style.transform     = 'translate(-50%,-50%) scale(1)';
    popup.style.pointerEvents = 'auto';
  }));
  _catRenderizarLista();
  fecharFormCategoria();
}

function fecharPopupCategorias() {
  const overlay = document.getElementById('popup-categorias-overlay');
  const popup   = document.getElementById('popup-categorias');
  popup.style.opacity       = '0';
  popup.style.transform     = 'translate(-50%,-50%) scale(0.94)';
  popup.style.pointerEvents = 'none';
  setTimeout(() => {
    popup.style.display   = 'none';
    overlay.style.display = 'none';
  }, 200);
}

function _catRenderizarLista() {
  const dados = _catCarregar();
  const lista = dados[_catTipoAtual] || [];
  const el    = document.getElementById('popup-cat-lista');
  // Remove tooltips fixos antigos criados por esta função
  document.querySelectorAll('.cat-row-tip-fixed').forEach(t => t.remove());
  el.innerHTML = '';

  if (lista.length === 0) {
    el.innerHTML = '<div class="popup-cat-vazio">Nenhuma categoria cadastrada ainda.</div>';
  } else {
    lista.forEach((cat, idx) => {
      const row = document.createElement('div');
      row.className = 'popup-cat-row';

      const badge = document.createElement('div');
      badge.className = 'popup-cat-badge';
      badge.style.background = cat.bg;
      badge.style.color = cat.color;
      badge.textContent = cat.nome;

      const btns = document.createElement('div');
      btns.className = 'popup-cat-row-btns';

      // Helper: cria botão com tooltip fixed no body
      function _criarBtnComTip(classes, svgHtml, tipText, tipClasses, onClickFn) {
        const btn = document.createElement('button');
        btn.className = classes;
        btn.innerHTML = svgHtml;
        btn.onclick = onClickFn;

        const tip = document.createElement('div');
        tip.className = 'lapis-tip-fixed' + (tipClasses ? ' ' + tipClasses : '');
        tip.textContent = tipText;
        document.body.appendChild(tip);

        btn.addEventListener('mouseenter', () => {
          const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
          const r = btn.getBoundingClientRect();
          tip.style.left   = (r.left / zoom + r.width / zoom / 2) + 'px';
          tip.style.top    = 'auto';
          tip.style.bottom = (window.innerHeight / zoom - r.top / zoom + 6) + 'px';
          tip.classList.add('visible');
        });
        btn.addEventListener('mouseleave', () => tip.classList.remove('visible'));
        btn.addEventListener('mousedown',  () => tip.classList.remove('visible'));
        // Marca para limpeza na próxima renderização
        tip.classList.add('cat-row-tip-fixed');
        return btn;
      }

      const btnEditar = _criarBtnComTip(
        'popup-cat-row-btn',
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        'Editar', '',
        () => editarCategoria(idx)
      );
      const btnExcluir = _criarBtnComTip(
        'popup-cat-row-btn excluir',
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
        'Excluir', 'cat-row-tip-excluir',
        () => excluirCategoria(idx)
      );

      btns.appendChild(btnEditar);
      btns.appendChild(btnExcluir);
      row.appendChild(badge);
      row.appendChild(btns);
      el.appendChild(row);
    });
  }

  const btnAdd = document.getElementById('popup-cat-btn-add');
  btnAdd.style.display = lista.length >= CAT_MAX ? 'none' : 'block';
  if (lista.length >= CAT_MAX) {
    if (!el.querySelector('.popup-cat-limite')) {
      const lim = document.createElement('div');
      lim.className = 'popup-cat-limite';
      lim.textContent = `Limite de ${CAT_MAX} categorias atingido.`;
      el.appendChild(lim);
    }
  }
}

function abrirFormCategoria(idx) {
  _catEditandoIdx = idx !== undefined ? idx : -1;
  const form = document.getElementById('popup-cat-form');
  const btnAdd = document.getElementById('popup-cat-btn-add');
  form.style.display = 'block';
  btnAdd.style.display = 'none';
  // Esconde header e lista enquanto form está aberto
  const headerEl = document.querySelector('#popup-categorias .popup-cat-header');
  if (headerEl) headerEl.style.display = 'none';
  const listaEl = document.getElementById('popup-cat-lista');
  if (listaEl) listaEl.style.display = 'none';

  if (_catEditandoIdx >= 0) {
    const dados = _catCarregar();
    const cat   = dados[_catTipoAtual][_catEditandoIdx];
    document.getElementById('popup-cat-form-titulo').textContent = 'Editar categoria';
    document.getElementById('popup-cat-nome').value     = cat.nome;
    document.getElementById('popup-cat-cor-bg').value   = cat.bg;
    document.getElementById('popup-cat-cor-text').value = cat.color;
    const swBg   = document.getElementById('swatch-bg');
    const swText = document.getElementById('swatch-text');
    if (swBg)   swBg.style.background   = cat.bg;
    if (swText) swText.style.background = cat.color;
  } else {
    document.getElementById('popup-cat-form-titulo').textContent = 'Nova categoria';
    document.getElementById('popup-cat-nome').value     = '';
    document.getElementById('popup-cat-cor-bg').value   = '#215a6c';
    document.getElementById('popup-cat-cor-text').value = '#ffffff';
    const swBg   = document.getElementById('swatch-bg');
    const swText = document.getElementById('swatch-text');
    if (swBg)   swBg.style.background   = '#215a6c';
    if (swText) swText.style.background = '#ffffff';
  }
  _catAtualizarPreview();
  document.getElementById('popup-cat-nome').focus();
}

function editarCategoria(idx) { abrirFormCategoria(idx); }

function fecharFormCategoria() {
  const form = document.getElementById('popup-cat-form');
  if (form) form.style.display = 'none';
  if (typeof fecharCatPicker === 'function') fecharCatPicker();
  // Restaura header e lista
  const headerEl = document.querySelector('#popup-categorias .popup-cat-header');
  if (headerEl) headerEl.style.display = '';
  const listaEl = document.getElementById('popup-cat-lista');
  if (listaEl) listaEl.style.display = '';
  const dados = _catCarregar();
  const lista = dados[_catTipoAtual] || [];
  const btnAdd = document.getElementById('popup-cat-btn-add');
  if (btnAdd) btnAdd.style.display = lista.length >= CAT_MAX ? 'none' : 'block';
}

// ── COLOR PICKER CUSTOMIZADO ──────────────────────────────────
(function() {
  let _cpAlvo = 'bg'; // 'bg' ou 'text'
  let _cpHue = 180;
  let _cpSatPct = 0.5;
  let _cpLightPct = 0.5;
  let _cpDragging = false;

  function _hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }

  function _hexToHsv(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0,2),16)/255, g = parseInt(hex.slice(2,4),16)/255, b = parseInt(hex.slice(4,6),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60); if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
  }

  function _hsvToHex(h, s, v) {
    const f = (n, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2,'0')).join('');
  }

  function _drawCanvas() {
    const canvas = document.getElementById('cat-cp-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    // Gradiente de saturação (branco → cor pura)
    const gS = ctx.createLinearGradient(0, 0, W, 0);
    gS.addColorStop(0, '#fff');
    gS.addColorStop(1, `hsl(${_cpHue},100%,50%)`);
    ctx.fillStyle = gS; ctx.fillRect(0, 0, W, H);
    // Gradiente de valor (transparente → preto)
    const gV = ctx.createLinearGradient(0, 0, 0, H);
    gV.addColorStop(0, 'rgba(0,0,0,0)');
    gV.addColorStop(1, '#000');
    ctx.fillStyle = gV; ctx.fillRect(0, 0, W, H);
    // Cursor
    const cx = _cpSatPct * W, cy = (1 - _cpLightPct) * H;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, 2 * Math.PI);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function _applyColor(hex) {
    const input  = document.getElementById('popup-cat-cor-' + _cpAlvo);
    const swatch = document.getElementById('swatch-' + _cpAlvo);
    if (input)  input.value = hex;
    if (swatch) swatch.style.background = hex;
    _catAtualizarPreview();
  }

  function _updateFromHsv() {
    const hex = _hsvToHex(_cpHue, _cpSatPct, _cpLightPct);
    const sp = document.getElementById('cat-cp-swatch-preview');
    const hx = document.getElementById('cat-cp-hex');
    if (sp) sp.style.background = hex;
    if (hx) hx.value = hex.toUpperCase();
    _applyColor(hex);
    _drawCanvas();
  }

  function _pickFromCanvas(e) {
    const canvas = document.getElementById('cat-cp-canvas');
    const r = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
    _cpSatPct   = x / r.width;
    _cpLightPct = 1 - y / r.height;
    _updateFromHsv();
  }

  window.abrirCatPicker = function(alvo) {
    _cpAlvo = alvo;
    const hex = document.getElementById('popup-cat-cor-' + alvo).value;
    const hsv = _hexToHsv(hex);
    _cpHue       = hsv.h;
    _cpSatPct    = hsv.s;
    _cpLightPct  = hsv.v;

    // Posição — próximo ao swatch clicado
    const swatch  = document.getElementById('swatch-' + alvo);
    const picker  = document.getElementById('cat-color-picker');
    const overlay = document.getElementById('cat-color-picker-overlay');
    picker.style.display  = 'block';
    overlay.style.display = 'block';

    const sr = swatch.getBoundingClientRect();
    let top = sr.bottom + 8, left = sr.left - 100;
    left = Math.max(8, Math.min(left, window.innerWidth - 280));
    top  = Math.min(top, window.innerHeight - 320);
    picker.style.top  = top  + 'px';
    picker.style.left = left + 'px';

    const hueInput = document.getElementById('cat-cp-hue');
    if (hueInput) hueInput.value = _cpHue;
    _updateFromHsv();
  };

  window.fecharCatPicker = function() {
    document.getElementById('cat-color-picker').style.display  = 'none';
    document.getElementById('cat-color-picker-overlay').style.display = 'none';
  };

  document.addEventListener('DOMContentLoaded', function() {
    const canvas = document.getElementById('cat-cp-canvas');
    if (!canvas) return;

    // Hue slider
    document.getElementById('cat-cp-hue').addEventListener('input', function() {
      _cpHue = +this.value;
      _updateFromHsv();
    });

    // Hex input
    document.getElementById('cat-cp-hex').addEventListener('input', function() {
      const v = this.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        const hsv = _hexToHsv(v);
        _cpHue = hsv.h; _cpSatPct = hsv.s; _cpLightPct = hsv.v;
        document.getElementById('cat-cp-hue').value = _cpHue;
        document.getElementById('cat-cp-swatch-preview').style.background = v;
        _applyColor(v);
        _drawCanvas();
      }
    });

    // Canvas drag
    canvas.addEventListener('mousedown', function(e) { _cpDragging = true; _pickFromCanvas(e); });
    document.addEventListener('mousemove', function(e) { if (_cpDragging) _pickFromCanvas(e); });
    document.addEventListener('mouseup', function() { _cpDragging = false; });

    // Touch
    canvas.addEventListener('touchstart', function(e) { _cpDragging = true; _pickFromCanvas(e.touches[0]); e.preventDefault(); }, {passive:false});
    document.addEventListener('touchmove', function(e) { if (_cpDragging) _pickFromCanvas(e.touches[0]); }, {passive:false});
    document.addEventListener('touchend',  function() { _cpDragging = false; });

    // Inicializar swatches com cores padrão
    const swBg   = document.getElementById('swatch-bg');
    const swText = document.getElementById('swatch-text');
    if (swBg)   swBg.style.background   = '#215a6c';
    if (swText) swText.style.background = '#ffffff';
  });
})();

// Event listeners para preview (inicializado uma vez no DOMContentLoaded)
document.addEventListener('DOMContentLoaded', function() {
  ['popup-cat-nome','popup-cat-cor-bg','popup-cat-cor-text'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', _catAtualizarPreview);
  });
});

function _catAtualizarPreview() {
  const nome  = document.getElementById('popup-cat-nome').value.trim() || 'Nome';
  const bg    = document.getElementById('popup-cat-cor-bg').value;
  const color = document.getElementById('popup-cat-cor-text').value;
  const prev  = document.getElementById('popup-cat-preview');
  prev.textContent       = nome;
  prev.style.background  = bg;
  prev.style.color       = color;
}

function salvarCategoria() {
  const nome  = document.getElementById('popup-cat-nome').value.trim();
  const bg    = document.getElementById('popup-cat-cor-bg').value;
  const color = document.getElementById('popup-cat-cor-text').value;
  if (!nome) { document.getElementById('popup-cat-nome').focus(); return; }

  const dados = _catCarregar();
  if (!Array.isArray(dados[_catTipoAtual])) dados[_catTipoAtual] = [];
  const lista = dados[_catTipoAtual];

  // Verifica duplicata (exceto ao editar o mesmo)
  const dupIdx = lista.findIndex((c, i) => c.nome.toLowerCase() === nome.toLowerCase() && i !== _catEditandoIdx);
  if (dupIdx >= 0) {
    document.getElementById('popup-cat-nome').classList.add('popup-cat-input-erro');
    setTimeout(() => document.getElementById('popup-cat-nome').classList.remove('popup-cat-input-erro'), 1200);
    return;
  }

  if (_catEditandoIdx >= 0) {
    const nomeAntigo = lista[_catEditandoIdx].nome;
    lista[_catEditandoIdx] = { nome, bg, color };
    // Atualiza dropdowns que tinham o nome antigo selecionado
    if (nomeAntigo !== nome) {
      document.querySelectorAll('select').forEach(sel => {
        if (sel.value === nomeAntigo) {
          sel.value = nome;
          if (sel._customDisplay) aplicarCorBancoDisplay(sel._customDisplay, nome);
        }
      });
    } else {
      // Só cor mudou — re-aplica
      document.querySelectorAll('select').forEach(sel => {
        if (sel.value === nome && sel._customDisplay) aplicarCorBancoDisplay(sel._customDisplay, nome);
      });
    }
  } else {
    if (lista.length >= CAT_MAX) return;
    lista.push({ nome, bg, color });
  }

  _catSalvar(dados);
  _catAplicar();
  _catAtualizarDropdowns(_catTipoAtual);
  fecharFormCategoria();
  _catRenderizarLista();
}

function excluirCategoria(idx) {
  const dados = _catCarregar();
  if (!Array.isArray(dados[_catTipoAtual])) return;
  const nome  = dados[_catTipoAtual][idx]?.nome;
  dados[_catTipoAtual].splice(idx, 1);
  _catSalvar(dados);
  // Limpa dropdowns que usavam essa categoria
  if (nome) {
    document.querySelectorAll('select').forEach(sel => {
      if (sel.value === nome) {
        sel.value = '';
        if (sel._customDisplay) {
          sel._customDisplay.textContent = 'Selecione';
          if (sel._customDisplay._clearBtn) {
            sel._customDisplay.appendChild(sel._customDisplay._clearBtn);
            sel._customDisplay._clearBtn.classList.remove('visible');
          }
          aplicarCorBancoDisplay(sel._customDisplay, '');
        }
      }
    });
    delete coresBancos[nome];
  }
  _catAplicar();
  _catAtualizarDropdowns(_catTipoAtual);
  fecharFormCategoria();
  _catRenderizarLista();
}

const coresBancos = {
  "Nubank":         { bg: "#8A05BE", color: "#fff" },
  "Itaú":           { bg: "#EC7000", color: "#fff" },
  "Picpay":         { bg: "#11C76F", color: "#fff" },
  "Bradesco":       { bg: "#CC0000", color: "#fff" },
  "Santander":      { bg: "#EC0000", color: "#fff" },
  "C6 Bank":        { bg: "#1A1A1A", color: "#F0C020", darkBg: true },
  "Inter":          { bg: "#FF6B00", color: "#fff" },
  "Caixa":          { bg: "#005CA9", color: "#fff" },
  "Banco do Brasil":{ bg: "#F8D100", color: "#003087" },
  "Mercado Pago":   { bg: "#009EE3", color: "#fff" },
  "PagBank":        { bg: "#F5A800", color: "#fff" },
  "Banco PAN":      { bg: "#034EA2", color: "#fff" },
  "BTG Pactual":    { bg: "#1C1C1C", color: "#C9A84C", darkBg: true },
  "Sicredi":        { bg: "#007A33", color: "#fff" },
  "Internet":       { bg: "#215a6c", color: "#fff" },
  "Água":           { bg: "#215a6c", color: "#fff" },
  "Energia":        { bg: "#215a6c", color: "#fff" },
  "Aluguel":        { bg: "#215a6c", color: "#fff" },
  "Financiamento":  { bg: "#215a6c", color: "#fff" },
  "Condomínio":     { bg: "#215a6c", color: "#fff" },
  "IPTU":           { bg: "#215a6c", color: "#fff" },
  "Original":       { bg: "#00A859", color: "#fff" },
};



function inicializarCoresBancos() {
  _catAplicar(); // Mescla categorias personalizadas antes de criar os dropdowns
  document.querySelectorAll(".bloco-wrap").forEach(bw => {
    const titulo = bw.querySelector("h3");
    if (!titulo) return;
    const txt = titulo.textContent.trim().toLowerCase();
    if (!txt.includes("cart") && !txt.includes("outr") && !txt.includes("resid")) return;
    bw.querySelectorAll("select").forEach(sel => {
      aplicarCorBanco(sel);
      sel.addEventListener("change", () => aplicarCorBanco(sel));
    });
  });
}


/* ── 7. DROPDOWN CUSTOMIZADO DE BANCOS ─────────────────────────────────
 *  O <select> nativo é ocultado e substituído por um div customizado.
 *  Motivo: exibir badges coloridos com o logo do banco selecionado.
 *  A lista dropdown é appendada ao <body> (não ao pai) para escapar de
 *  qualquer overflow:hidden nos ancestrais.
 *  Referências importantes no DOM:
 *    selectOriginal._customDisplay → div visível (badge colorido)
 *    display._list                 → ul dropdown
 *    display._clearBtn             → botão ×
 * ────────────────────────────────────────────────────────────────────── */
/* ── DROPDOWN CUSTOMIZADO DE BANCOS ────────────────────────────────────
 *  O <select> nativo é ocultado e substituído por um div com badge colorido.
 *  A lista é appendada ao <body> para escapar de overflow:hidden.
 *  selectOriginal._customDisplay → div badge; display._clearBtn → botão ×
 * ────────────────────────────────────────────────────────────────────── */
/* ── DROPDOWN CUSTOMIZADO BANCOS ── */
const bancosResidencia = ["Selecione","Internet","Água","Energia","Aluguel","Financiamento","Condomínio","IPTU"];
const bancosCartao = ["Selecione","Banco do Brasil","Banco PAN","Bradesco","BTG Pactual","C6 Bank","Caixa","Inter","Itaú","Mercado Pago","Nubank","Original","PagBank","Picpay","Santander","Sicredi"];
const bancosOutros  = ["Selecione","Banco do Brasil","Banco PAN","Bradesco","BTG Pactual","C6 Bank","Caixa","Inter","Itaú","Mercado Pago","Nubank","Original","PagBank","Picpay","Santander","Sicredi"];
// Tamanhos fixos das listas padrão — sentinels para limpeza em _catAplicar
const _CAT_RES_PADRAO    = 8;   // Selecione + 7 itens
const _CAT_CART_PADRAO   = 16;  // Selecione + 15 bancos
const _CAT_OUTROS_PADRAO = 16;  // Selecione + 15 bancos

function atualizarDisplayVazio(display, valor) {
  display.classList.toggle("vazio", !valor);
}

function criarSelectBanco(selectOriginal) {
  const wrap = document.createElement("div");
  wrap.className = "select-banco-wrap";

  const display = document.createElement("div");
  display.className = "select-banco-display";
  display.textContent = selectOriginal.value || "Selecione";
  if (!selectOriginal.value) display.classList.add("vazio");

  const clearBtn = document.createElement("span");
  clearBtn.className = "select-banco-clear";
  clearBtn.textContent = "×";
  clearBtn.title = "";
  const tooltipClear = document.createElement("span");
  tooltipClear.className = "limpar-categoria-tooltip";
  tooltipClear.textContent = "Limpar categoria";
  // tooltipClear will be appended to wrap (not clearBtn) to avoid overflow:hidden clipping
  clearBtn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    clearTimeout(_tooltipTimer);
    tooltipClear.style.opacity = "0";
    tooltipClear.style.visibility = "hidden";
    selectOriginal.value = "";
    display.textContent = "Selecione";
    display.appendChild(clearBtn);
    aplicarCorBancoDisplay(display, "");
    atualizarDisplayVazio(display, "");
    clearBtn.classList.remove("visible");
    list.classList.remove("open");
    // Volta ícone de subcategoria para cinza quando categoria é limpa
    const linha = selectOriginal.closest(".linha");
    if (linha) {
      const btnSub = linha.querySelector(".btn-subcategoria-linha");
      if (btnSub) atualizarTooltipSubcategoria(btnSub, linha);
    }
    recalc();
  });

  const list = document.createElement("div");
  list.className = "select-banco-list";

  const blocoTitulo = selectOriginal.closest(".bloco-wrap")?.querySelector("h3")?.textContent.trim().toLowerCase() || "";
  const _tipoBlocoSel = _catTipoPorBloco(blocoTitulo);
  const listaOpcoes = _tipoBlocoSel === 'residencia' ? bancosResidencia : _tipoBlocoSel === 'cartoes' ? bancosCartao : bancosOutros;

  listaOpcoes.forEach(banco => {
    if (banco === "Selecione") return;
    const item = document.createElement("div");
    item.className = "select-banco-item";
    item.textContent = banco;
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectOriginal.value = banco;
      display.textContent = banco;
      display.appendChild(clearBtn);
      aplicarCorBancoDisplay(display, banco);
      atualizarDisplayVazio(display, banco);
      clearBtn.classList.add("visible");
      list.classList.remove("open");
      // Atualiza cor do ícone de subcategoria para herdar a nova categoria
      const linha = selectOriginal.closest(".linha");
      if (linha) {
        const btnSub = linha.querySelector(".btn-subcategoria-linha");
        if (btnSub) atualizarTooltipSubcategoria(btnSub, linha);
      }
      recalc();
    });
    list.appendChild(item);
  });

  // Campo de busca
  const search = document.createElement("input");
  search.className = "select-banco-search";
  search.autocomplete = "off";
  search.placeholder = "Buscar...";
  search.addEventListener("input", () => {
    const q = search.value.toLowerCase();
    let firstVisible = null;
    list.querySelectorAll(".select-banco-item").forEach(item => {
      const match = item.textContent.toLowerCase().includes(q);
      item.classList.toggle("hidden", !match);
      item.classList.remove("highlighted");
      if (match && !firstVisible) firstVisible = item;
    });
    if (firstVisible) firstVisible.classList.add("highlighted");
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const highlighted = list.querySelector(".select-banco-item.highlighted");
      if (highlighted) highlighted.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
  });
  list.insertBefore(search, list.firstChild);

  // Mover a list para o body para escapar de qualquer overflow:hidden
  document.body.appendChild(list);
  // Injeta botão lápis (será recriado com o tipo correto)
  const _tipoBlocoLapis = _tipoBlocoSel;
  _catInjetarLapis(list, _tipoBlocoLapis);

  display.addEventListener("click", (e) => {
    e.stopPropagation();
    // Fecha todos os outros
    document.querySelectorAll(".select-banco-list.open").forEach(l => l.classList.remove("open"));
    list.classList.toggle("open");
    if (list.classList.contains("open")) {
      // Posiciona usando fixed com coordenadas reais do display
      const rect = display.getBoundingClientRect();
      const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      list.style.position = "fixed";
      list.style.top  = (rect.bottom / z + 2) + "px";
      list.style.left = (rect.left / z) + "px";
      list.style.width = Math.max(rect.width / z, 180) + "px";
      list.style.zIndex = "99999";
      search.value = "";
      list.querySelectorAll(".select-banco-item").forEach(i => { i.classList.remove("hidden"); i.classList.remove("highlighted"); });
      setTimeout(() => search.focus(), 50);
    }
  });

  document.addEventListener("click", () => list.classList.remove("open"));

  let _tooltipTimer;

  // Tooltip no wrap para não ser cortado pelo overflow:hidden do display
  wrap.appendChild(tooltipClear);
  // Mostrar/esconder tooltip via JS
  clearBtn.addEventListener("mouseenter", () => {
    _tooltipTimer = setTimeout(() => { tooltipClear.style.opacity = "1"; tooltipClear.style.visibility = "visible"; }, 600);
  });
  clearBtn.addEventListener("mouseleave", () => {
    clearTimeout(_tooltipTimer);
    tooltipClear.style.opacity = "0";
    tooltipClear.style.visibility = "hidden";
  });
  clearBtn.addEventListener("mousedown", () => {
    clearTimeout(_tooltipTimer);
    tooltipClear.style.opacity = "0";
    tooltipClear.style.visibility = "hidden";
  });

  display.appendChild(clearBtn);
  wrap.appendChild(display);
  wrap.appendChild(list);

  // Esconder o select original mas manter no DOM para salvar/carregar
  selectOriginal.style.display = "none";
  selectOriginal.parentNode.insertBefore(wrap, selectOriginal);

  // Guardar referência para sincronizar ao carregar mês
  selectOriginal._customDisplay = display;
  display._list = list; // referência para o tour
  display._clearBtn = clearBtn;

  // Aplicar cor inicial se já tiver valor
  aplicarCorBancoDisplay(display, selectOriginal.value);
  if (selectOriginal.value) clearBtn.classList.add("visible");
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

function aplicarCorBancoDisplay(display, valor) {
  const cor = coresBancos[valor];
  const clearBtn = display._clearBtn;
  const isDark = document.body.classList.contains("dark") || document.documentElement.classList.contains("dark-early");
  if (cor) {
    if (isDark) {
      const tintHex = cor.darkBg ? cor.color : cor.bg;
      const rgb = hexToRgb(tintHex);
      display.style.background = `rgba(${rgb}, 0.18)`;
      display.style.color = cor.darkBg ? cor.color : "#fff";
      display.style.borderColor = `rgba(${rgb}, 0.45)`;
    } else {
      display.style.background = cor.bg;
      display.style.color = cor.color;
      display.style.borderColor = cor.bg;
    }
    display.classList.add("colored");
    // X sempre branco quando banco selecionado (fundo colorido)
    if (clearBtn) clearBtn.style.setProperty("color", "#ffffff", "important");
  } else {
    display.style.background = "";
    display.style.color = "";
    display.style.borderColor = "";
    display.classList.remove("colored");
    if (!valor) {
      display.childNodes.forEach(n => { if (n !== clearBtn) n.remove(); });
      display.insertBefore(document.createTextNode("Selecione"), display.firstChild);
      if (clearBtn) clearBtn.style.color = "";
    }
    atualizarDisplayVazio(display, valor);
  }
}

function inicializarCoresBancos() {
  _catAplicar(); // Mescla categorias personalizadas antes de criar os dropdowns
  document.querySelectorAll(".bloco-wrap").forEach(bw => {
    const titulo = bw.querySelector("h3");
    if (!titulo) return;
    const txt = titulo.textContent.trim().toLowerCase();
    if (!txt.includes("cart") && !txt.includes("outr") && !txt.includes("resid")) return;
    bw.querySelectorAll("select").forEach(sel => {
      if (!sel._customDisplay) criarSelectBanco(sel);
    });
  });
}

// Sincronizar dropdowns customizados após carregar mês do localStorage
function sincronizarDropdownsBancos() {
  document.querySelectorAll(".bloco-wrap").forEach(bw => {
    const titulo = bw.querySelector("h3");
    if (!titulo) return;
    const txt = titulo.textContent.trim().toLowerCase();
    if (!txt.includes("cart") && !txt.includes("outr") && !txt.includes("resid")) return;
    bw.querySelectorAll("select").forEach(sel => {
      if (sel._customDisplay) {
        const val = sel.value;
        sel._customDisplay.textContent = val || "Selecione";
        if (val) sel._customDisplay.appendChild(sel._customDisplay._clearBtn);
        aplicarCorBancoDisplay(sel._customDisplay, val);
        if (sel._customDisplay._clearBtn) {
          sel._customDisplay._clearBtn.classList.toggle("visible", !!val);
        }
      }
    });
  });
}


/* ── 8. TOAST AVISO (ORÇAMENTO ESTOURADO) ──────────────────────────────
 *  Exibido automaticamente quando a previsão de saldo fica negativa.
 *  Fica no topo-direito da tela. Tem um timer visual de barra.
 *  Se o usuário já tem saldo em reserva/meta, exibe botão "Usar saldo"
 *  que abre o popup de cobertura de déficit.
 *  _toastJaExibidoParaEsteSalario evita re-exibição enquanto o salário
 *  não mudar (evita spam ao editar campos).
 * ────────────────────────────────────────────────────────────────────── */
/* ── TOAST AVISO (ORÇAMENTO ESTOURADO) ─────────────────────────────────
 *  Exibido quando a previsão de saldo fica negativa.
 *  Se há saldo em reserva/meta, exibe botão "Usar saldo".
 *  _toastJaExibidoParaEsteSalario: evita re-exibição enquanto salário não mudar.
 * ────────────────────────────────────────────────────────────────────── */
/* ── TOAST AVISO ── */
let toastAvisoAtivo = false;
let _toastTimer = null;

// Flag em memória: reseta sempre que o salário for confirmado.
// Controla se o toast já foi exibido para o salário atual.
let _toastJaExibidoParaEsteSalario = false;

function exibirToastAviso(forcar = false) {
  if (!forcar && _toastJaExibidoParaEsteSalario) return;
  clearTimeout(_toastTimer);
  toastAvisoAtivo = true;
  _toastJaExibidoParaEsteSalario = true;
  const toast = document.getElementById("toast-aviso");
  const bar   = document.getElementById("toast-timer-bar");
  toast.classList.remove("saindo");
  bar.classList.remove("correndo");

  // Atualiza visibilidade do botão "Sacar para cobrir"
  atualizarBotaoCobrirToast();

  // Tempo maior quando o botão de cobrir está visível
  const btnCobrir = document.getElementById("toast-btn-cobrir");
  const temBotaoCobrir = btnCobrir && btnCobrir.style.display !== "none";
  const duracao = temBotaoCobrir ? 9000 : 5000;
  bar.style.setProperty("--toast-duracao", duracao + "ms");

  // Se já está visível, reinicia apenas o timer e a barra — tremor para sinalizar
  if (toast.classList.contains("visivel")) {
    const prevTransition = toast.style.transition;
    toast.style.transition = "none";
    void toast.offsetWidth;
    toast.style.transition = prevTransition;
    bar.classList.remove("correndo");
    void bar.offsetWidth;
    bar.classList.add("correndo");
    toast.classList.remove("toast-shake");
    void toast.offsetWidth;
    toast.classList.add("toast-shake");
    _toastTimer = setTimeout(() => fecharToastAviso(), duracao);
    return;
  }

  toast.classList.add("visivel");
  void bar.offsetWidth;
  bar.classList.add("correndo");
  _reposicionarToasts();
  _toastTimer = setTimeout(() => fecharToastAviso(), duracao);
}

function fecharToastAviso(porAcao = false) {
  clearTimeout(_toastTimer);
  toastAvisoAtivo = false;
  const toast = document.getElementById("toast-aviso");

  // Atualiza botão no tooltip do ícone de aviso
  _atualizarBotaoTooltip();

  toast.classList.add("saindo");
  setTimeout(() => {
    toast.classList.remove("visivel", "saindo", "toast-sistema");
    _reposicionarToasts();
  }, 300);
}

/* legado — mantido para não quebrar chamadas existentes */
function exibirPopupAviso() { exibirToastAviso(); }
function fecharPopupAviso()  { fecharToastAviso(true); }

/* ── BOTÃO NO TOOLTIP DO TRIÂNGULO (!) ─────────────────────────────────
 *  O ícone (!) no painel direito tem um tooltip com botão "Usar reserva".
 *  Só aparece quando há déficit E saldo disponível em reserva/meta.
 * ────────────────────────────────────────────────────────────────────── */
/* ── BOTÃO NO TOOLTIP DO TRIÂNGULO ── */
function _atualizarBotaoTooltip() {
  const btn = document.getElementById("aviso-tooltip-btn");
  if (!btn) return;
  const temReserva = _getSaldoReserva() > 0;
  const temMeta    = _getSaldoMeta() > 0;
  const deficit    = _getDeficit();

  if (deficit > 0 && (temReserva || temMeta)) {
    if (temReserva && temMeta)       btn.textContent = "Usar reserva ou meta";
    else if (temReserva)             btn.textContent = "Usar reserva";
    else                             btn.textContent = "Usar valor da meta";
    btn.style.display = "block";
  } else {
    btn.style.display = "none";
  }
}

function _esconderBadgeCobrir() { _atualizarBotaoTooltip(); }
function _mostrarBadgeCobrir()  { _atualizarBotaoTooltip(); }

/* ── BOTÃO "SACAR PARA COBRIR" NO TOAST ── */
function _getSaldoReserva() {
  const d = carregarSaldoReserva();
  if (!d) return 0;
  const movs = d.movimentos || [];
  return movs.length > 0 ? calcularSaldoAteMes(movs, anoAtual, indice) : (d.saldo || 0);
}

function _getSaldoMeta() {
  let total = 0;
  _META_KEYS.forEach((_, slotIdx) => {
    const d = carregarDadosMeta(slotIdx);
    if (!d) return;
    const movs = d.movimentos || [];
    total += movs.length > 0 ? calcularSaldoAteMes(movs, anoAtual, indice) : num(d.saldoAcumulado || "R$ 0,00");
  });
  return total;
}

function _getDeficit() {
  // Usa diretamente o valor da previsão de saldo que o recalc já calculou corretamente
  // (inclui gastos + depósitos em reserva/meta - salário)
  const el = document.getElementById("p-previsao");
  const previsaoSaldo = el ? num(el.textContent) : 0;
  return Math.max(0, -previsaoSaldo);
}

function atualizarBotaoCobrirToast() {
  const btn = document.getElementById("toast-btn-cobrir");
  if (!btn) return;
  const deficit = _getDeficit();
  const temReserva = _getSaldoReserva() > 0;
  const temMeta    = _getSaldoMeta() > 0;
  btn.style.display = (deficit > 0 && (temReserva || temMeta)) ? "inline-flex" : "none";
}

/* ── 9. POPUP COBRIR DÉFICIT ────────────────────────────────────────────
 *  Permite ao usuário sacar da reserva e/ou meta para cobrir um déficit
 *  no mês atual. Regra: só disponível se todos os meses ANTERIORES
 *  estiverem fechados (fechamento contábil).
 *  O valor sacado é registrado como "cobrir-deficit" nos movimentos e
 *  rastreado em localStorage("cobrir_valor_ANO_MES").
 *  Se os gastos diminuírem depois, o excedente é devolvido automaticamente
 *  em _reverterCoberturaParcial().
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP COBRIR DÉFICIT ───────────────────────────────────────────────
 *  Saca da reserva/meta para cobrir déficit do mês.
 *  Requer fechamento de todos os meses anteriores.
 *  Valor sacado → registrado como "cobrir-deficit" nos movimentos.
 *  Se gastos diminuírem depois, excedente é devolvido automaticamente.
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP COBRIR ── */
let _cobrirSelecionadas = new Set(); // ids selecionados

function _getFontesCobrir() {
  const fontes = [];
  const saldoRes  = _getSaldoReserva();
  const saldoMeta = _getSaldoMeta();
  if (saldoRes  > 0) fontes.push({ id: "reserva", label: "Reserva de Emergência", saldo: saldoRes });
  if (saldoMeta > 0) fontes.push({ id: "meta",    label: "Meta",                  saldo: saldoMeta });
  return fontes;
}

function abrirPopupCobrir() {
  // Regra: só pode sacar se todos os meses anteriores estiverem fechados
  if (!_todosAnterioresFechados(anoAtual, indice)) {
    const nomeAberto = _ultimoMesAberto(anoAtual, indice);
    exibirToastSaldo(`Para usar a reserva, realize o fechamento contábil em ${nomeAberto} — meses em aberto anteriores também serão fechados automaticamente.`);
    return;
  }
  const _x_popup_cobrir = document.getElementById("x-popup-cobrir"); if (_x_popup_cobrir) _x_popup_cobrir.style.display = "flex";
  const deficit = _getDeficit();
  const fontes  = _getFontesCobrir();
  if (!fontes.length) return;

  const todasCobrem = fontes.every(f => f.saldo >= deficit);
  const umaFonte    = fontes.length === 1;
  // Modo checkbox: mais de uma fonte e pelo menos uma não cobre sozinha
  const modoChk     = !umaFonte && !todasCobrem;

  // Seleção padrão
  _cobrirSelecionadas = new Set();
  if (umaFonte) {
    _cobrirSelecionadas.add(fontes[0].id);
  } else if (todasCobrem) {
    _cobrirSelecionadas.add(fontes[0].id); // radio → primeira marcada
  } else {
    // Checkbox → marca por padrão só as que cobrem sozinhas
    const cobrem = fontes.filter(f => f.saldo >= deficit);
    if (cobrem.length > 0) cobrem.forEach(f => _cobrirSelecionadas.add(f.id));
    else fontes.forEach(f => _cobrirSelecionadas.add(f.id)); // nenhuma cobre → todas
  }

  document.getElementById("popup-cobrir-sub").textContent = "";
  document.getElementById("popup-cobrir-deficit").textContent = brl(deficit);

  // Inicializa seletor de bloco destino
  window._cobrirBlocoDestino = 1;
  const sal1Cob = num(document.getElementById('sal1').value);
  const sal2Cob = num(document.getElementById('sal2').value);
  const destWrap = document.getElementById('popup-cobrir-dest-wrap');
  if (destWrap) {
    destWrap.style.display = (sal1Cob > 0 && sal2Cob > 0) ? 'block' : 'none';
    _cobrirSelecionarBloco(1);
  }
  _renderOpcoesCobrir(fontes, deficit, modoChk, umaFonte);
  _recalcValorCobrir(deficit, fontes);

  const overlay = document.getElementById("popup-cobrir-overlay");
  const popup   = document.getElementById("popup-cobrir");
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => {
    popup.style.opacity       = "1";
    popup.style.transform     = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "auto";
  });
}

function _renderOpcoesCobrir(fontes, deficit, modoChk, bloqueada) {
  const el = document.getElementById("popup-cobrir-opcoes");
  el.innerHTML = "";
  fontes.forEach(f => {
    const sel = _cobrirSelecionadas.has(f.id);
    const div = document.createElement("div");
    div.className = "cobrir-opcao" + (sel ? " ativa" : "") + (bloqueada ? " bloqueada" : "");

    if (modoChk) {
      div.innerHTML = `
        <input type="checkbox" name="cobrir-origem" value="${f.id}" ${sel ? "checked" : ""}>
        <div class="cobrir-opcao-info">
          <div class="cobrir-opcao-label">${f.label}</div>
          <div class="cobrir-opcao-saldo">Saldo disponível: ${brl(f.saldo)}</div>
        </div>`;
      div.addEventListener("click", e => {
        const chk = div.querySelector("input[type=checkbox]");
        if (e.target !== chk) chk.checked = !chk.checked;
        if (chk.checked) _cobrirSelecionadas.add(f.id);
        else             _cobrirSelecionadas.delete(f.id);
        div.classList.toggle("ativa", chk.checked);
        _recalcValorCobrir(deficit, fontes);
      });
    } else {
      div.innerHTML = `
        <input type="radio" name="cobrir-origem" value="${f.id}" ${sel ? "checked" : ""} ${bloqueada ? "disabled" : ""}>
        <div class="cobrir-opcao-info">
          <div class="cobrir-opcao-label">${f.label}</div>
          <div class="cobrir-opcao-saldo">Saldo disponível: ${brl(f.saldo)}</div>
        </div>`;
      if (!bloqueada) {
        div.addEventListener("click", () => {
          _cobrirSelecionadas = new Set([f.id]);
          el.querySelectorAll(".cobrir-opcao").forEach(d => {
            d.classList.remove("ativa");
            d.querySelector("input[type=radio]").checked = false;
          });
          div.classList.add("ativa");
          div.querySelector("input[type=radio]").checked = true;
          _recalcValorCobrir(deficit, fontes);
        });
      }
    }
    el.appendChild(div);
  });
}

function _recalcValorCobrir(deficit, fontes) {
  const totalSel  = fontes.filter(f => _cobrirSelecionadas.has(f.id)).reduce((s, f) => s + f.saldo, 0);
  const valorSaque = Math.min(deficit, totalSel);
  document.getElementById("popup-cobrir-valor").textContent = brl(valorSaque);
  const avisoEl = document.getElementById("popup-cobrir-aviso");
  if (avisoEl) {
    avisoEl.textContent   = "O valor do saque não cobrirá todo o saldo negativo.";
    avisoEl.style.display = totalSel < deficit ? "block" : "none";
  }
}

function fecharPopupCobrir() {
  const _x_popup_cobrir = document.getElementById("x-popup-cobrir"); if (_x_popup_cobrir) _x_popup_cobrir.style.display = "none";
  const overlay = document.getElementById("popup-cobrir-overlay");
  const popup   = document.getElementById("popup-cobrir");
  if (!popup) return;
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.93)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    overlay.style.display = "none";
  }, 220);
}

function _cobrirSelecionarBloco(bloco) {
  window._cobrirBlocoDestino = bloco;
  const b1 = document.getElementById('popup-cobrir-dest-b1');
  const b2 = document.getElementById('popup-cobrir-dest-b2');
  if (!b1 || !b2) return;
  const isDark = document.body.classList.contains('dark');
  const gradAtivo = isDark ? 'linear-gradient(135deg,#2a52b0,#4a7ed8)' : 'linear-gradient(135deg,#1c3f91,#3a6edc)';
  const corInativo = isDark ? 'rgba(255,255,255,0.6)' : '#8a9cc8';
  const bordaInativa = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(58,110,220,0.2)';
  if (bloco === 1) {
    b1.style.background = gradAtivo; b1.style.color = '#fff'; b1.style.borderColor = 'transparent';
    b2.style.background = 'none'; b2.style.color = corInativo; b2.style.borderColor = bordaInativa;
  } else {
    b2.style.background = gradAtivo; b2.style.color = '#fff'; b2.style.borderColor = 'transparent';
    b1.style.background = 'none'; b1.style.color = corInativo; b1.style.borderColor = bordaInativa;
  }
}

function confirmarCobrir() {
  const deficit  = _getDeficit();
  const fontes   = _getFontesCobrir();
  const selec    = fontes.filter(f => _cobrirSelecionadas.has(f.id));
  if (!selec.length) { fecharPopupCobrir(); return; }

  const totalDisp = selec.reduce((s, f) => s + f.saldo, 0);
  let   restante  = Math.min(deficit, totalDisp);
  if (restante <= 0) { fecharPopupCobrir(); return; }

  // Ordem: primeiro esgota as insuficientes, depois saca o restante das suficientes
  const insuf = selec.filter(f => f.saldo < deficit);
  const sufic = selec.filter(f => f.saldo >= deficit);
  const ordemSaque = [...insuf, ...sufic];

  let totalSacado = 0;

  ordemSaque.forEach(f => {
    if (restante <= 0) return;
    const saque = Math.min(restante, f.saldo);
    restante -= saque;
    totalSacado += saque;

    if (f.id === "reserva") {
      const dados = carregarSaldoReserva();
      dados.movimentos = dados.movimentos || [];
      dados.movimentos.push({ acao: "retirar", valor: saque, data: new Date().toISOString(), mes: indice, ano: anoAtual, origem: "cobrir-deficit" });
      dados.saldo = calcularSaldoAteMes(dados.movimentos, anoAtual, indice);
      salvarSaldoReserva(dados);
      // Atualiza dep_reserva_ para que o recalc reflita nos badges
      const chaveDepResCob = "dep_reserva_" + anoAtual + "_" + indice;
      const depResAtualCob = parseFloat(localStorage.getItem(chaveDepResCob) || "0");
      localStorage.setItem(chaveDepResCob, Math.max(0, depResAtualCob - saque).toFixed(2));
      atualizarDisplayReserva();
    } else if (f.id === "meta") {
      // Saca de cada slot de meta proporcionalmente ao seu saldo
      let restanteMeta = saque;
      _META_KEYS.forEach((chaveLS, slotIdx) => {
        if (restanteMeta <= 0) return;
        const dados = carregarDadosMeta(slotIdx);
        if (!dados) return;
        const saldoSlot = calcularSaldoAteMes(dados.movimentos || [], anoAtual, indice);
        if (saldoSlot <= 0) return;
        const saqueSlot = Math.min(restanteMeta, saldoSlot);
        dados.movimentos = dados.movimentos || [];
        dados.movimentos.push({ acao: "retirar", valor: saqueSlot, data: new Date().toISOString(), mes: indice, ano: anoAtual, origem: "cobrir-deficit" });
        dados.saldoAcumulado = brl(calcularSaldoAteMes(dados.movimentos, anoAtual, indice));
        localStorage.setItem(chaveLS, JSON.stringify(dados));
        restanteMeta -= saqueSlot;
      });
      atualizarBarraReserva();
    }
  });

  // Registra em qual bloco o dinheiro da cobertura entra
  // (para que o badge daquele bloco reflita o alívio)
  // IMPORTANTE: cobrir_valor_ é salvo DEPOIS de _aplicarRetiradaBloco para evitar
  // que o recalc interno ao aplicarMovimentoPrevisao reverta a cobertura prematuramente
  _aplicarRetiradaBloco(window._cobrirBlocoDestino || 1, totalSacado);

  // Rastreia o valor sacado como cobertura (salvo após _aplicarRetiradaBloco)
  const chaveCobertura = "cobrir_valor_" + anoAtual + "_" + indice;
  const cobAcum = parseFloat(localStorage.getItem(chaveCobertura) || "0");
  localStorage.setItem(chaveCobertura, (cobAcum + totalSacado).toFixed(2));

  recalc();

  fecharPopupCobrir();
  fecharToastAviso(true);
  _esconderBadgeCobrir();

  const feedbackEl = document.createElement("div");
  feedbackEl.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
    background:linear-gradient(135deg,#1c3f91,#3a6edc);color:#fff;padding:12px 24px;
    border-radius:10px;font-size:13px;font-weight:700;font-family:'Outfit','Century Gothic',sans-serif;
    box-shadow:0 4px 20px rgba(58,110,220,0.4);z-index:99999;white-space:nowrap;`;
  feedbackEl.textContent = `✓ ${brl(totalSacado)} sacado com sucesso.`;
  document.body.appendChild(feedbackEl);
  setTimeout(() => feedbackEl.remove(), 3000);
}

function atualizarAvisoIcone(mostrar) {
  const avisoIcone = document.getElementById("aviso-icone");
  if (mostrar) {
    avisoIcone.classList.add("visivel");
  } else {
    avisoIcone.classList.remove("visivel");
  }
}

/* ── 10. POPUP ALTERAR SALÁRIO ──────────────────────────────────────────
 *  Se o usuário diminui o salário e já há depósitos na reserva/meta
 *  que não caberiam no novo saldo, o sistema pede confirmação.
 *  Ao confirmar, os depósitos manuais deste mês são revertidos e o
 *  recalc é executado com o novo salário.
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP ALTERAR SALÁRIO ──────────────────────────────────────────────
 *  Ao diminuir o salário com depósitos ativos que não caberiam no novo
 *  saldo, pede confirmação. Ao confirmar, depósitos deste mês são revertidos.
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP ALTERAR SALÁRIO COM DEPÓSITO NO MÊS ── */
let _alterarSalarioPendente = false;
let _salarioAnterior = { sal1: "", sal2: "", extrasSnapshot: null };

function _totalDepositadoMes() {
  // Soma depósitos na reserva deste mês
  const depRes = parseFloat(localStorage.getItem("dep_reserva_" + anoAtual + "_" + indice) || "0");

  // Soma depósitos em cada slot de meta deste mês
  let depMeta = 0;
  _META_KEYS.forEach((_, slotIdx) => {
    depMeta += parseFloat(localStorage.getItem("dep_meta_" + slotIdx + "_" + anoAtual + "_" + indice) || "0");
  });

  return depRes + depMeta;
}

function _executarAlteracaoSalario() {
  _toastJaExibidoParaEsteSalario = false;

  const sal1 = num(document.getElementById("sal1").value);
  const sal2 = num(document.getElementById("sal2").value);

  if (sal1 + sal2 === 0) {
    const chaveAdj     = "mov_previsao_" + anoAtual + "_" + indice;
    const chaveCob     = "cobrir_valor_"  + anoAtual + "_" + indice;
    const chaveDepRes  = "dep_reserva_"   + anoAtual + "_" + indice;
    const chaveDepMeta = "dep_meta_"      + anoAtual + "_" + indice;

    // ── Reserva: remove TODOS os movimentos deste mês (depósitos e coberturas) ──
    {
      const reserva = carregarSaldoReserva();
      reserva.movimentos = (reserva.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice)
      );
      reserva.saldo = calcularSaldoAteMes(reserva.movimentos, anoAtual, indice);
      salvarSaldoReserva(reserva);
      atualizarDisplayReserva();
      localStorage.setItem(chaveDepRes, "0");
    }

    // ── Meta: remove TODOS os movimentos deste mês em cada slot ──
    _META_KEYS.forEach((chaveLS, slotIdx) => {
      const metaSlot = carregarDadosMeta(slotIdx);
      if (metaSlot) {
        metaSlot.movimentos = (metaSlot.movimentos || []).filter(m =>
          !(m.ano === anoAtual && m.mes === indice)
        );
        metaSlot.saldoAcumulado = brl(calcularSaldoAteMes(metaSlot.movimentos, anoAtual, indice));
        localStorage.setItem(chaveLS, JSON.stringify(metaSlot));
      }
      const chaveSlot = "dep_meta_" + slotIdx + "_" + anoAtual + "_" + indice;
      localStorage.setItem(chaveSlot, "0");
    });
    localStorage.setItem(chaveDepMeta, "0");
    atualizarBarraReserva();

    localStorage.setItem(chaveAdj, "0");
    localStorage.setItem(chaveCob, "0");
    localStorage.removeItem('mov_previsao_blocos_' + anoAtual + '_' + indice);
  }

  recalc(true, true);
}

/* ── ENTRADAS EXTRAS DE SALÁRIO ─────────────────────────────────────────
 *  Popover flutuante posicionado ao lado do botão +, sem overlay.
 *  Um único popover no DOM é reaproveitado para entrada 1 e 2.
 *  Dados: extras_sal_ANO_MES = { '1': [{nome,valor},...], 'base1': '', ... }
 * ────────────────────────────────────────────────────────────────────── */
const _EXTRAS_SAL_KEY = () => `extras_sal_${anoAtual}_${indice}`;
let _extrasEntradaAtiva = null;

function _extrasCarregar() {
  try {
    const d = JSON.parse(localStorage.getItem(_EXTRAS_SAL_KEY()) || '{}');
    if (!Array.isArray(d['1'])) d['1'] = [];
    if (!Array.isArray(d['2'])) d['2'] = [];
    // Por padrão, modo informativo desativado (false)
    if (d['info1'] === undefined) d['info1'] = false;
    if (d['info2'] === undefined) d['info2'] = false;
    return d;
  }
  catch(e) { return { '1': [], '2': [], info1: false, info2: false }; }
}
function _extrasSalvar(dados) {
  localStorage.setItem(_EXTRAS_SAL_KEY(), JSON.stringify(dados));
}

function _extrasIsSomar(entrada) {
  const dados = _extrasCarregar();
  return dados['info' + entrada] === true; // padrão false (não soma)
}

// Flag: guarda a entrada ativa quando o toggle de informativo dispara validação
let _extrasInfoTogglePendente = null;
// Flag: guarda {entrada, idx} quando exclusão de linha de extra dispara validação
let _extrasDelPendente = null;
// Flag: guarda {entrada, idx, novoValor} quando edição de valor dispara validação
let _extrasEditValPendente = null;

function toggleExtrasSalInfo() {
  if (!_extrasEntradaAtiva) return;
  const dados = _extrasCarregar();
  const estaAtivando = !dados['info' + _extrasEntradaAtiva]; // true = ativando somar

  // Se está DESATIVANDO o somar e há depósitos no mês, pede confirmação
  if (!estaAtivando) {
    const totalDep = _totalDepositadoMes();
    if (totalDep > 0) {
      _extrasInfoTogglePendente = _extrasEntradaAtiva;
      const msg = `Existem <strong>${brl(totalDep)}</strong> depositados na reserva/meta este mês. Para deixar de somar a renda extra ao salário, esse valor será devolvido à previsão de saldo para um novo cálculo. Deseja continuar?`;
      document.getElementById("popup-alterar-salario-msg").innerHTML = msg;
      const overlay = document.getElementById("popup-alterar-salario-overlay");
      const popup   = document.getElementById("popup-alterar-salario");
      overlay.style.display = "block";
      popup.style.display   = "block";
      requestAnimationFrame(() => requestAnimationFrame(() => {
        popup.style.opacity       = "1";
        popup.style.transform     = "translate(-50%,-50%) scale(1)";
        popup.style.pointerEvents = "auto";
      }));
      return;
    }
  }

  dados['info' + _extrasEntradaAtiva] = estaAtivando;
  _extrasSalvar(dados);
  _extrasAtualizarToggleUI(_extrasEntradaAtiva);
  recalcExtrasSal(_extrasEntradaAtiva);
}

function _extrasAtualizarToggleUI(entrada) {
  const isInfo  = _extrasIsSomar(entrada);
  const track   = document.getElementById('extras-sal-toggle-track');
  const thumb   = document.getElementById('extras-sal-toggle-thumb');
  if (!track || !thumb) return;
  track.classList.toggle('ativo', isInfo);
  thumb.style.transform = isInfo ? 'translateX(16px)' : 'translateX(0)';
}

function _extrasTotalSal(entrada) {
  const dados  = _extrasCarregar();
  const salBase = num(document.getElementById('sal' + entrada)?._valorBase || '');
  const extras  = (dados[String(entrada)] || []).reduce((s, e) => s + num(e.valor), 0);
  return salBase + extras;
}

function recalcExtrasSal(entrada) {
  if (!entrada || mesFechado(anoAtual, indice)) return;
  const dados    = _extrasCarregar();
  const extras   = (dados[String(entrada)] || []).reduce((s, e) => s + num(e.valor), 0);
  const salInput = document.getElementById('sal' + entrada);
  const base     = num(salInput._valorBase || '');
  const isInfo   = _extrasIsSomar(entrada);
  // Só soma ao salário se isSomar=true
  const total    = isInfo ? base + extras : base;
  salInput.value = total > 0 ? brl(total) : (salInput._valorBase || '');
  _atualizarReadonlySal(entrada);
  agendarSalvoComFeedback();
  recalc(true, true);
}

function toggleSalMenu(entrada) {
  const menu  = document.getElementById('sal-menu-' + entrada);
  const outro = document.getElementById('sal-menu-' + (entrada === 1 ? 2 : 1));
  if (!menu) return;
  // Fecha o outro se estiver aberto
  if (outro) outro.classList.remove('aberto');
  menu.classList.toggle('aberto');
}

// Fecha menus de salário ao clicar fora
document.addEventListener('mousedown', function(e) {
  [1, 2].forEach(function(n) {
    const menu = document.getElementById('sal-menu-' + n);
    const wrap = document.getElementById('sal-menu-wrap-' + n);
    if (menu && menu.classList.contains('aberto') && wrap && !wrap.contains(e.target)) {
      menu.classList.remove('aberto');
    }
  });
});

function toggleExtrasSal(entrada) {
  // Fecha o menu ⋯ se estiver aberto
  [1, 2].forEach(function(n) {
    const m = document.getElementById('sal-menu-' + n);
    if (m) m.classList.remove('aberto');
  });
  const pop = document.getElementById('extras-sal-popover');
  if (_extrasEntradaAtiva === entrada && pop.classList.contains('visivel')) {
    fecharExtrasSal();
    return;
  }
  _extrasEntradaAtiva = entrada;
  const anchor = document.getElementById('sal-menu-wrap-' + entrada) || document.getElementById('btn-extras-sal' + entrada);
  const r   = anchor.getBoundingClientRect();
  const z   = _getCssZoom ? _getCssZoom() : 1;
  pop.style.top  = (r.bottom / z + 8) + 'px';
  pop.style.left = Math.max(8, r.left / z - 160) + 'px';
  _extrasAtualizarToggleUI(entrada);
  _extrasRenderizar(entrada);
  _extrasAtualizarBaseUI(entrada);
  pop.classList.add('visivel');
  [1, 2].forEach(e => document.getElementById('btn-extras-sal' + e)?.classList.remove('ativo'));
  document.getElementById('btn-extras-sal' + entrada)?.classList.add('ativo');
}

function _extrasAtualizarBaseUI(entrada) {
  const baseInput = document.getElementById('extras-sal-base-input');
  if (!baseInput) return;
  const salInput = document.getElementById('sal' + entrada);
  // Mostra o _valorBase (base puro) se existir, senão o valor atual do campo
  const base = salInput._valorBase !== undefined && salInput._valorBase !== ''
    ? salInput._valorBase
    : (salInput.value || '');
  baseInput.value = base;
  // Eventos: formata e sincroniza com o campo principal
  baseInput.oninput = () => fmtInput(baseInput);
  baseInput.onblur  = () => {
    fmt(baseInput);
    const salInp = document.getElementById('sal' + _extrasEntradaAtiva);
    if (!salInp) return;
    salInp._valorBase = baseInput.value;
    // Grava o novo base em dados['base'+entrada] para persistência
    const d = _extrasCarregar();
    d['base' + _extrasEntradaAtiva] = baseInput.value;
    _extrasSalvar(d);
    recalcExtrasSal(_extrasEntradaAtiva);
  };
  baseInput.onkeydown = (e) => { if (e.key === 'Enter') { fmt(baseInput); baseInput.blur(); } };
}

function fecharExtrasSal() {
  document.getElementById('extras-sal-popover').classList.remove('visivel');
  [1, 2].forEach(e => document.getElementById('btn-extras-sal' + e)?.classList.remove('ativo'));
  _extrasEntradaAtiva = null;
}

function adicionarExtraSal(entrada) {
  if (!entrada) return;
  if (mesFechado(anoAtual, indice)) { exibirToastSaldo('Mês fechado.'); return; }
  const dados = _extrasCarregar();
  if ((dados[String(entrada)] || []).length >= 8) { exibirToastSaldo('Limite de 8 entradas extras atingido.'); return; }
  // Grava o base puro na primeira extra, para que _extrasCarregarMes restaure corretamente
  if (!dados['base' + entrada] && dados['base' + entrada] !== '') {
    const salInput = document.getElementById('sal' + entrada);
    dados['base' + entrada] = salInput._valorBase !== undefined ? salInput._valorBase : salInput.value;
  }
  dados[String(entrada)].push({ nome: '', valor: '' });
  _extrasSalvar(dados);
  _extrasRenderizar(entrada);
}

function _extrasRenderizar(entrada) {
  const dados = _extrasCarregar();
  const lista = dados[String(entrada)] || [];
  const el    = document.getElementById('extras-sal-lista');
  el.innerHTML = '';
  // Actualiza estado readonly do campo sal
  _atualizarReadonlySal(entrada);

  lista.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'extras-sal-row';

    const nomeInput = document.createElement('input');
    nomeInput.type         = 'text';
    nomeInput.className    = 'extras-sal-nome';
    nomeInput.placeholder  = 'Ex: 13º salário';
    nomeInput.value        = item.nome;
    nomeInput.autocomplete = 'off';
    nomeInput.oninput = () => {
      const d = _extrasCarregar();
      d[String(entrada)][idx].nome = nomeInput.value;
      _extrasSalvar(d);
    };
    nomeInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); valInput.focus(); valInput.select(); } };

    const valInput = document.createElement('input');
    valInput.type         = 'text';
    valInput.className    = 'extras-sal-valor';
    valInput.placeholder  = 'R$ 0,00';
    valInput.value        = item.valor;
    valInput.autocomplete = 'off';
    valInput.oninput  = () => fmtInput(valInput);
    let _valAnterior = 0;
    valInput.onfocus  = () => {
      row.classList.add('val-focado');
      _valAnterior = num(valInput.value);
    };
    valInput.onblur   = () => {
      row.classList.remove('val-focado');
      fmt(valInput);
      const novoVal = num(valInput.value);
      const totalDep = _totalDepositadoMes();
      // Se reduziu o valor e há depósitos, pede confirmação
      if (totalDep > 0 && novoVal < _valAnterior) {
        // Restaura valor anterior visualmente enquanto aguarda confirmação
        const dTemp = _extrasCarregar();
        valInput.value = dTemp[String(entrada)][idx].valor;
        fmt(valInput);
        _extrasInfoTogglePendente = null;
        _extrasDelPendente = null;
        _extrasEditValPendente = { entrada, idx, novoValor: brl(novoVal) };
        const msg = `Existem <strong>${brl(totalDep)}</strong> depositados na reserva/meta este mês. Para alterar esta entrada, esse valor será devolvido à previsão de saldo para um novo cálculo. Deseja continuar?`;
        document.getElementById("popup-alterar-salario-msg").innerHTML = msg;
        const overlay = document.getElementById("popup-alterar-salario-overlay");
        const popup   = document.getElementById("popup-alterar-salario");
        overlay.style.display = "block";
        popup.style.display   = "block";
        requestAnimationFrame(() => requestAnimationFrame(() => {
          popup.style.opacity       = "1";
          popup.style.transform     = "translate(-50%,-50%) scale(1)";
          popup.style.pointerEvents = "auto";
        }));
        return;
      }
      const d = _extrasCarregar();
      d[String(entrada)][idx].valor = valInput.value;
      _extrasSalvar(d);
      recalcExtrasSal(entrada);
    };
    valInput.onkeydown = (e) => { if (e.key === 'Enter') { fmt(valInput); valInput.blur(); } };

    const delBtn = document.createElement('button');
    delBtn.className = 'extras-sal-del';
    delBtn.innerHTML = '×';
    delBtn.tabIndex  = -1;
    delBtn.onclick   = () => {
      // Se a linha está em branco, apaga sem validação
      const d0 = _extrasCarregar();
      const item0 = (d0[String(entrada)] || [])[idx];
      const linhaVazia = !item0 || (!num(item0.valor) && !(item0.nome || '').trim());
      // Se há depósitos no mês E a linha tem valor, valida antes de remover
      const totalDep = _totalDepositadoMes();
      if (totalDep > 0 && !linhaVazia) {
        _extrasInfoTogglePendente = null;
        _extrasDelPendente = { entrada, idx };
        const msg = `Existem <strong>${brl(totalDep)}</strong> depositados na reserva/meta este mês. Para remover esta entrada, esse valor será devolvido à previsão de saldo para um novo cálculo. Deseja continuar?`;
        document.getElementById("popup-alterar-salario-msg").innerHTML = msg;
        const overlay = document.getElementById("popup-alterar-salario-overlay");
        const popup   = document.getElementById("popup-alterar-salario");
        overlay.style.display = "block";
        popup.style.display   = "block";
        requestAnimationFrame(() => requestAnimationFrame(() => {
          popup.style.opacity       = "1";
          popup.style.transform     = "translate(-50%,-50%) scale(1)";
          popup.style.pointerEvents = "auto";
        }));
        return;
      }
      const d = _extrasCarregar();
      d[String(entrada)].splice(idx, 1);
      _extrasSalvar(d);
      _extrasRenderizar(entrada);
      recalcExtrasSal(entrada);
    };

    const enterBtn = document.createElement('button');
    enterBtn.className = 'extras-sal-enter';
    enterBtn.innerHTML = '↵';
    enterBtn.tabIndex = -1;
    enterBtn.onmousedown = (e) => { e.preventDefault(); fmt(valInput); valInput.blur(); };

    row.appendChild(nomeInput);
    row.appendChild(valInput);
    row.appendChild(enterBtn);
    row.appendChild(delBtn);
    el.appendChild(row);
  });

  el.style.marginBottom = lista.length > 0 ? '10px' : '0';
}

function _extrasCarregarMes() {
  [1, 2].forEach(entrada => {
    const salInput = document.getElementById('sal' + entrada);
    const dados    = _extrasCarregar();
    const isInfo   = _extrasIsSomar(entrada);
    const extras   = (dados[String(entrada)] || []).reduce((s, e) => s + num(e.valor), 0);
    // Usa o base puro gravado em dados['base'+entrada] como fonte de verdade.
    // Isso evita dupla soma independente do que salvarMes gravou no campo.
    const baseSalvo = dados['base' + entrada];
    if (baseSalvo !== undefined) {
      salInput.value      = baseSalvo;
      salInput._valorBase = baseSalvo;
    } else {
      salInput._valorBase = salInput.value;
    }
    // Só soma ao campo se isSomar=true
    if (isInfo && extras > 0) {
      salInput.value = brl(num(salInput._valorBase) + extras);
    }
    // Aplica estado readonly se há extras
    _atualizarReadonlySal(entrada);
  });
  if (_extrasEntradaAtiva) _extrasRenderizar(_extrasEntradaAtiva);
}

function limparEntradaSal(entrada) {
  if (mesFechado(anoAtual, indice)) { exibirToastSaldo('Mês fechado.'); return; }
  // Guarda snapshot das extras ANTES de limpar, para poder restaurar se cancelar
  _salarioAnterior.extrasSnapshot = JSON.parse(JSON.stringify(_extrasCarregar()));
  const dados = _extrasCarregar();
  dados[String(entrada)] = [];
  delete dados['base' + entrada];
  _extrasSalvar(dados);
  const salInput = document.getElementById('sal' + entrada);
  salInput.value = '';
  salInput._valorBase = '';
  if (_extrasEntradaAtiva === entrada) _extrasRenderizar(entrada);
  _atualizarReadonlySal(entrada);
  confirmarSalario();
}

// Fecha popover ao clicar fora
let _extrasPopoverBlocked = false;
document.addEventListener('mousedown', function(e) {
  // Bloqueia se a flag estiver ativa OU se o popup de confirmação estiver aberto
  if (_extrasPopoverBlocked) return;
  const confirmPopup = document.getElementById('popup-alterar-salario');
  if (confirmPopup && confirmPopup.style.display === 'block') return;
  const pop = document.getElementById('extras-sal-popover');
  if (!pop || !pop.classList.contains('visivel')) return;
  if (pop.contains(e.target)) return;
  if (e.target.closest('.btn-extras-sal')) return;
  fecharExtrasSal();
});

// Actualiza o estado readonly do campo sal quando há extras activas
function _atualizarReadonlySal(entrada) {
  const input = document.getElementById('sal' + entrada);
  if (!input) return;
  const dados = _extrasCarregar();
  const temExtras = (dados[String(entrada)] || []).length > 0;
  const isInfo    = dados['info' + entrada] === true;
  const bloquear  = temExtras && isInfo;
  if (bloquear) {
    input.classList.add('com-extras');
    input.readOnly = true;
  } else {
    input.classList.remove('com-extras');
    input.readOnly = false;
  }
}

// Se o usuário digita diretamente no sal, limpa extras e guarda novo base
document.addEventListener('DOMContentLoaded', function() {
  [1, 2].forEach(entrada => {
    const input = document.getElementById('sal' + entrada);
    if (!input) return;

    // Enter: só confirma salário se não há extras activas com somar ativo
    input.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      const dados    = _extrasCarregar();
      const temExtras = (dados[String(entrada)] || []).length > 0;
      const isInfo    = dados['info' + entrada] === true;
      if (temExtras && isInfo) {
        e.preventDefault();
        input.blur();
      } else {
        confirmarSalario();
      }
    });

    // Input: só rejeita digitação se há extras com somar ativo
    input.addEventListener('input', function() {
      const dados     = _extrasCarregar();
      const temExtras = (dados[String(entrada)] || []).length > 0;
      const isInfo    = dados['info' + entrada] === true;
      if (temExtras && isInfo) {
        // Restaura o valor total e abre o popover para edição
        const extras = (dados[String(entrada)] || []).reduce((s, e) => s + num(e.valor), 0);
        const base   = num(input._valorBase || '');
        const total  = base + extras;
        input.value  = total > 0 ? brl(total) : (input._valorBase || '');
        // Abre popover se não estiver aberto
        if (_extrasEntradaAtiva !== entrada) {
          toggleExtrasSal(entrada);
        }
        return;
      }
      input._valorBase = input.value;
      // Sincroniza campo base do popover se estiver aberto para esta entrada
      if (_extrasEntradaAtiva === entrada) {
        const baseInput = document.getElementById('extras-sal-base-input');
        if (baseInput) baseInput.value = input.value;
      }
    });

    // Blur: só restaura total se há extras com somar ativo
    input.addEventListener('blur', function() {
      const dados     = _extrasCarregar();
      const temExtras = (dados[String(entrada)] || []).length > 0;
      const isInfo    = dados['info' + entrada] === true;
      if (temExtras && isInfo) {
        const extras = (dados[String(entrada)] || []).reduce((s, e) => s + num(e.valor), 0);
        const base   = num(input._valorBase || '');
        const total  = base + extras;
        input.value  = total > 0 ? brl(total) : (input._valorBase || '');
      }
    });
  });
});

function confirmarSalario() {
  if (mesFechado(anoAtual, indice)) {
    exibirToastSaldo("Este mês está fechado. Reabra-o para editar o salário.");
    return;
  }

  // Lê os valores salvos no localStorage (antes da edição atual)
  const chaveMes = "planejamento_" + anoAtual + "_" + indice;
  const dadosSalvos = JSON.parse(localStorage.getItem(chaveMes) || "{}");
  const totalAnterior = num(dadosSalvos.sal1 || "") + num(dadosSalvos.sal2 || "");

  // Lê o novo valor digitado na tela
  const totalNovo = num(document.getElementById("sal1").value) + num(document.getElementById("sal2").value);

  // Só verifica conflito se o total diminuiu
  if (totalNovo < totalAnterior) {
    const totalDep = _totalDepositadoMes();
    if (totalDep > 0) {
      // Calcula total de gastos atual na tela
      let totalGastos = 0;
      document.querySelectorAll(".val-input").forEach(i => { totalGastos += num(i.value); });

      // Saldo disponível com o novo salário
      const saldoNovo = totalNovo - totalGastos;

      // Só bloqueia se o novo saldo não comporta o que foi depositado
      if (saldoNovo < totalDep) {
        // Guarda os valores salvos para restaurar se cancelar
        _salarioAnterior.sal1 = dadosSalvos.sal1 || "";
        _salarioAnterior.sal2 = dadosSalvos.sal2 || "";
        // Guarda snapshot das extras se ainda não foi salvo por limparEntradaSal
        if (!_salarioAnterior.extrasSnapshot) {
          _salarioAnterior.extrasSnapshot = JSON.parse(JSON.stringify(_extrasCarregar()));
        }

        const msg = `Existem <strong>${brl(totalDep)}</strong> depositados na reserva/meta este mês. Para alterar o salário, esse valor será devolvido à previsão de saldo para um novo cálculo. Deseja continuar?`;
        document.getElementById("popup-alterar-salario-msg").innerHTML = msg;

        const overlay = document.getElementById("popup-alterar-salario-overlay");
        const popup   = document.getElementById("popup-alterar-salario");
        overlay.style.display = "block";
        popup.style.display   = "block";
        requestAnimationFrame(() => requestAnimationFrame(() => {
          popup.style.opacity       = "1";
          popup.style.transform     = "translate(-50%,-50%) scale(1)";
          popup.style.pointerEvents = "auto";
        }));
        return;
      }
    }
  }

  _executarAlteracaoSalario();
}

function fecharPopupAlterarSalario() {
  // Se veio do toggle, exclusão ou edição de valor de extra, apenas fecha — sem restaurar salários
  if (_extrasInfoTogglePendente !== null || _extrasDelPendente !== null || _extrasEditValPendente !== null) {
    const entradaReabrir = _extrasInfoTogglePendente !== null
      ? _extrasInfoTogglePendente
      : _extrasDelPendente !== null
        ? _extrasDelPendente.entrada
        : _extrasEditValPendente.entrada;
    _extrasInfoTogglePendente = null;
    _extrasDelPendente = null;
    _extrasEditValPendente = null;
    const overlay = document.getElementById("popup-alterar-salario-overlay");
    const popup   = document.getElementById("popup-alterar-salario");
    popup.style.opacity       = "0";
    popup.style.transform     = "translate(-50%,-50%) scale(0.94)";
    popup.style.pointerEvents = "none";
    setTimeout(() => {
      popup.style.display   = "none";
      overlay.style.display = "none";
      // Reabre o popover de renda extra (bloqueia mousedown para não fechar imediatamente)
      const popover = document.getElementById("extras-sal-popover");
      if (popover && entradaReabrir !== null) {
        _extrasPopoverBlocked = true;
        _extrasEntradaAtiva = entradaReabrir;
        _extrasRenderizar(entradaReabrir);
        popover.classList.add("visivel");
        setTimeout(() => { _extrasPopoverBlocked = false; }, 300);
      }
    }, 220);
    return;
  }
  // Restaura os valores anteriores na tela para que o cancelamento não deixe campos errados
  if (_salarioAnterior.sal1 !== undefined) {
    document.getElementById("sal1").value = _salarioAnterior.sal1;
    document.getElementById("sal2").value = _salarioAnterior.sal2;
    // Restaura também os dados das extras se havia snapshot salvo
    if (_salarioAnterior.extrasSnapshot) {
      _extrasSalvar(_salarioAnterior.extrasSnapshot);
      // Atualiza _valorBase do campo com o valor do snapshot restaurado
      [1, 2].forEach(e => {
        const inp = document.getElementById('sal' + e);
        if (inp) {
          const snap = _salarioAnterior.extrasSnapshot;
          const base = snap['base' + e] || '';
          inp._valorBase = base;
          const extras = (snap[String(e)] || []).reduce((s, x) => s + num(x.valor), 0);
          const isInfo = snap['info' + e] === true;
          const total = isInfo ? num(base) + extras : num(base);
          inp.value = total > 0 ? brl(total) : base;
        }
      });
      // Re-renderiza o popover se estiver aberto
      if (_extrasEntradaAtiva !== null) _extrasRenderizar(_extrasEntradaAtiva);
    }
    _salarioAnterior = { sal1: "", sal2: "", extrasSnapshot: null };
    recalc();
    salvarMes(); // persiste o estado restaurado — sem isso o localStorage fica com o valor zerado
  }

  const overlay = document.getElementById("popup-alterar-salario-overlay");
  const popup   = document.getElementById("popup-alterar-salario");
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.94)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    overlay.style.display = "none";
  }, 220);
}

function _fecharPopupAlterarSalarioSemRestaurar() {
  _salarioAnterior = { sal1: "", sal2: "", extrasSnapshot: null }; // limpa sem restaurar
  const overlay = document.getElementById("popup-alterar-salario-overlay");
  const popup   = document.getElementById("popup-alterar-salario");
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.94)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    overlay.style.display = "none";
  }, 220);
}

function confirmarAlterarSalario() {
  // Se a confirmação veio de edição de valor reduzido numa linha extra
  if (_extrasEditValPendente !== null) {
    const { entrada, idx, novoValor } = _extrasEditValPendente;
    _extrasEditValPendente = null;
    _fecharPopupAlterarSalarioSemRestaurar();

    // Reverte depósitos do mês
    {
      const reserva = carregarSaldoReserva();
      const movsFiltrados = (reserva.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && !m.origem)
      );
      if (movsFiltrados.length !== (reserva.movimentos || []).length) {
        reserva.movimentos = movsFiltrados;
        reserva.saldo = calcularSaldoAteMes(reserva.movimentos, anoAtual, indice);
        salvarSaldoReserva(reserva);
        atualizarDisplayReserva();
        localStorage.setItem("dep_reserva_" + anoAtual + "_" + indice, "0");
      }
    }
    _META_KEYS.forEach((chaveLS, slotIdx) => {
      const metaSlot = carregarDadosMeta(slotIdx);
      if (!metaSlot) return;
      const movsFiltrados = (metaSlot.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && !m.origem)
      );
      if (movsFiltrados.length !== (metaSlot.movimentos || []).length) {
        metaSlot.movimentos = movsFiltrados;
        metaSlot.saldoAcumulado = brl(calcularSaldoAteMes(metaSlot.movimentos, anoAtual, indice));
        localStorage.setItem(chaveLS, JSON.stringify(metaSlot));
        localStorage.setItem("dep_meta_" + slotIdx + "_" + anoAtual + "_" + indice, "0");
      }
    });
    atualizarBarraReserva();
    localStorage.setItem("mov_previsao_" + anoAtual + "_" + indice, "0");

    // Aplica o novo valor
    const d = _extrasCarregar();
    if (d[String(entrada)] && d[String(entrada)][idx] !== undefined) {
      d[String(entrada)][idx].valor = novoValor;
      _extrasSalvar(d);
    }
    _extrasRenderizar(entrada);
    recalcExtrasSal(entrada);
    recalc();
    salvarMes();

    // Reabre popover
    const popover = document.getElementById("extras-sal-popover");
    if (popover) {
      _extrasPopoverBlocked = true;
      _extrasEntradaAtiva = entrada;
      popover.classList.add("visivel");
      setTimeout(() => { _extrasPopoverBlocked = false; }, 300);
    }
    return;
  }

  // Se a confirmação veio do toggle de renda extra informativa, trata separadamente
  if (_extrasInfoTogglePendente !== null) {
    const entrada = _extrasInfoTogglePendente;
    _extrasInfoTogglePendente = null;
    _fecharPopupAlterarSalarioSemRestaurar();

    // Reverte depósitos do mês (mesma lógica do fluxo de salário)
    {
      const reserva = carregarSaldoReserva();
      const movsFiltrados = (reserva.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && !m.origem)
      );
      if (movsFiltrados.length !== (reserva.movimentos || []).length) {
        reserva.movimentos = movsFiltrados;
        reserva.saldo = calcularSaldoAteMes(reserva.movimentos, anoAtual, indice);
        salvarSaldoReserva(reserva);
        atualizarDisplayReserva();
        localStorage.setItem("dep_reserva_" + anoAtual + "_" + indice, "0");
      }
    }
    _META_KEYS.forEach((chaveLS, slotIdx) => {
      const metaSlot = carregarDadosMeta(slotIdx);
      if (!metaSlot) return;
      const movsFiltrados = (metaSlot.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && !m.origem)
      );
      if (movsFiltrados.length !== (metaSlot.movimentos || []).length) {
        metaSlot.movimentos = movsFiltrados;
        metaSlot.saldoAcumulado = brl(calcularSaldoAteMes(metaSlot.movimentos, anoAtual, indice));
        localStorage.setItem(chaveLS, JSON.stringify(metaSlot));
        localStorage.setItem("dep_meta_" + slotIdx + "_" + anoAtual + "_" + indice, "0");
      }
    });
    atualizarBarraReserva();
    localStorage.setItem("mov_previsao_" + anoAtual + "_" + indice, "0");
    const _chaveCobConf2 = "cobrir_valor_" + anoAtual + "_" + indice;
    const _cobValConf2 = parseFloat(localStorage.getItem(_chaveCobConf2) || "0");
    if (_cobValConf2 > 0) {
      const _reservaConf2 = carregarSaldoReserva();
      _reservaConf2.movimentos = (_reservaConf2.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && m.acao === "retirar" && m.origem === "cobrir-deficit")
      );
      _reservaConf2.saldo = calcularSaldoAteMes(_reservaConf2.movimentos, anoAtual, indice);
      salvarSaldoReserva(_reservaConf2);
      atualizarDisplayReserva();
      localStorage.setItem(_chaveCobConf2, "0");
    }
    localStorage.removeItem('mov_previsao_blocos_' + anoAtual + '_' + indice);

    // Aplica o toggle informativo e recalcula
    const dados = _extrasCarregar();
    dados['info' + entrada] = false;
    _extrasSalvar(dados);
    _extrasAtualizarToggleUI(entrada);
    recalcExtrasSal(entrada);
    return;
  }

  // Se veio da exclusão de uma linha de extra
  if (_extrasDelPendente !== null) {
    const { entrada: entDel, idx: idxDel } = _extrasDelPendente;
    _extrasDelPendente = null;
    _fecharPopupAlterarSalarioSemRestaurar();
    {
      const reserva = carregarSaldoReserva();
      const movsFiltrados = (reserva.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && !m.origem)
      );
      if (movsFiltrados.length !== (reserva.movimentos || []).length) {
        reserva.movimentos = movsFiltrados;
        reserva.saldo = calcularSaldoAteMes(reserva.movimentos, anoAtual, indice);
        salvarSaldoReserva(reserva);
        atualizarDisplayReserva();
        localStorage.setItem("dep_reserva_" + anoAtual + "_" + indice, "0");
      }
    }
    _META_KEYS.forEach((chaveLS, slotIdx) => {
      const metaSlot = carregarDadosMeta(slotIdx);
      if (!metaSlot) return;
      const movsFiltrados = (metaSlot.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && !m.origem)
      );
      if (movsFiltrados.length !== (metaSlot.movimentos || []).length) {
        metaSlot.movimentos = movsFiltrados;
        metaSlot.saldoAcumulado = brl(calcularSaldoAteMes(metaSlot.movimentos, anoAtual, indice));
        localStorage.setItem(chaveLS, JSON.stringify(metaSlot));
        localStorage.setItem("dep_meta_" + slotIdx + "_" + anoAtual + "_" + indice, "0");
      }
    });
    atualizarBarraReserva();
    localStorage.setItem("mov_previsao_" + anoAtual + "_" + indice, "0");
    const _chaveCobDel = "cobrir_valor_" + anoAtual + "_" + indice;
    const _cobValDel = parseFloat(localStorage.getItem(_chaveCobDel) || "0");
    if (_cobValDel > 0) {
      const _reservaDel = carregarSaldoReserva();
      _reservaDel.movimentos = (_reservaDel.movimentos || []).filter(m =>
        !(m.ano === anoAtual && m.mes === indice && m.acao === "retirar" && m.origem === "cobrir-deficit")
      );
      _reservaDel.saldo = calcularSaldoAteMes(_reservaDel.movimentos, anoAtual, indice);
      salvarSaldoReserva(_reservaDel);
      atualizarDisplayReserva();
      localStorage.setItem(_chaveCobDel, "0");
    }
    localStorage.removeItem('mov_previsao_blocos_' + anoAtual + '_' + indice);
    const d = _extrasCarregar();
    d[String(entDel)].splice(idxDel, 1);
    if (d[String(entDel)].length === 0) delete d['base' + entDel];
    _extrasSalvar(d);
    _extrasRenderizar(entDel);
    recalcExtrasSal(entDel);
    return;
  }

  _fecharPopupAlterarSalarioSemRestaurar();

  const chaveAdj = "mov_previsao_" + anoAtual + "_" + indice;

  // Remove TODOS os movimentos manuais da reserva deste mês (depósitos e retiradas).
  // Retiradas manuais órfãs (sem depósito correspondente) causariam saldo negativo
  // e disparariam recalcs incorretos depois.
  {
    const reserva = carregarSaldoReserva();
    const movsFiltrados = (reserva.movimentos || []).filter(m =>
      !(m.ano === anoAtual && m.mes === indice && !m.origem)
    );
    if (movsFiltrados.length !== (reserva.movimentos || []).length) {
      reserva.movimentos = movsFiltrados;
      reserva.saldo = calcularSaldoAteMes(reserva.movimentos, anoAtual, indice);
      salvarSaldoReserva(reserva);
      atualizarDisplayReserva();
      localStorage.setItem("dep_reserva_" + anoAtual + "_" + indice, "0");
    }
  }

  // Remove TODOS os movimentos manuais de cada slot de meta deste mês (depósitos e retiradas).
  _META_KEYS.forEach((chaveLS, slotIdx) => {
    const metaSlot = carregarDadosMeta(slotIdx);
    if (!metaSlot) return;
    const movsFiltrados = (metaSlot.movimentos || []).filter(m =>
      !(m.ano === anoAtual && m.mes === indice && !m.origem)
    );
    if (movsFiltrados.length !== (metaSlot.movimentos || []).length) {
      metaSlot.movimentos = movsFiltrados;
      metaSlot.saldoAcumulado = brl(calcularSaldoAteMes(metaSlot.movimentos, anoAtual, indice));
      localStorage.setItem(chaveLS, JSON.stringify(metaSlot));
      localStorage.setItem("dep_meta_" + slotIdx + "_" + anoAtual + "_" + indice, "0");
    }
  });
  atualizarBarraReserva();

  // Zera o mov_previsao — todos os depósitos foram devolvidos, não resta ajuste pendente
  localStorage.setItem(chaveAdj, "0");

  // Zera cobrir_valor — a retirada que cobriu o déficit foi revertida junto com os depósitos;
  // manter cobrir_valor causaria _reverterCoberturaParcial() no recalc,
  // devolvendo dinheiro "fantasma" à reserva (que já foi zerada) e sumindo 500 do badge
  const _chaveCobConf = "cobrir_valor_" + anoAtual + "_" + indice;
  const _cobValConf = parseFloat(localStorage.getItem(_chaveCobConf) || "0");
  if (_cobValConf > 0) {
    // Remove também os movimentos de retirada de cobertura da reserva deste mês,
    // pois o saque já foi desfeito pela reversão dos depósitos acima
    const _reservaConf = carregarSaldoReserva();
    _reservaConf.movimentos = (_reservaConf.movimentos || []).filter(m =>
      !(m.ano === anoAtual && m.mes === indice && m.acao === "retirar" && m.origem === "cobrir-deficit")
    );
    _reservaConf.saldo = calcularSaldoAteMes(_reservaConf.movimentos, anoAtual, indice);
    salvarSaldoReserva(_reservaConf);
    atualizarDisplayReserva();
    localStorage.setItem(_chaveCobConf, "0");
  }

  // Zera distribuição por bloco — sem depósitos ativos, retB1/retB2 residuais
  // causariam desconto negativo nos badges (ex: retB2=200 sem depB2 → badge -200)
  localStorage.removeItem('mov_previsao_blocos_' + anoAtual + '_' + indice);

  _executarAlteracaoSalario();
}

/* ── 11. UTILS — DATAS, FORMATAÇÃO E DROPDOWNS ─────────────────────────
 *  meses[]: array dos nomes dos meses (0=Janeiro...11=Dezembro)
 *  anos[]:  anos disponíveis no sistema (2026–2030)
 *  anoAtual / indice: estado global da tela — qual mês/ano está visível
 *  fmt(input): formata o input como "R$ 0,00" ao perder foco
 *  fmtInput(input): formata em tempo real preservando o cursor
 *  num(str): converte "R$ 1.234,56" → 1234.56
 *  brl(n): converte 1234.56 → "R$ 1.234,56"
 *  pct(n): converte 12.5 → "12,50%"
 *
 *  LIMITES:
 *    ANO_MIN = 2026 / MES_MIN = 0  (Janeiro 2026)
 *    ANO_MAX = 2030 / MES_MAX = 11 (Dezembro 2030)
 * ────────────────────────────────────────────────────────────────────── */
/* ── UTILS: DATAS, FORMATAÇÃO E DROPDOWNS ──────────────────────────────
 *  meses[] / anos[]: listas de nomes e anos disponíveis (2026-2030)
 *  anoAtual / indice: estado global da tela
 *  fmt() → formata no blur | fmtInput() → formata em tempo real
 *  num(str) → "R$ 1.234,56" para 1234.56 | brl(n) → inverso | pct(n) → "%"
 *  LIMITES: Janeiro 2026 (ANO_MIN/MES_MIN) → Dezembro 2030 (ANO_MAX/MES_MAX)
 * ────────────────────────────────────────────────────────────────────── */
/* ── UTILS ── */
const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
let indice = new Date().getMonth();
document.getElementById("titulomes").innerText = meses[indice];

/* ── MIGRAÇÃO: tagga movimentos antigos com mes/ano ── */
(function migrarMovimentos() {
  // Reserva
  const reserva = carregarSaldoReserva();
  let mudouRes = false;
  (reserva.movimentos || []).forEach(m => {
    if (m.mes === undefined && m.data) {
      const d = new Date(m.data);
      m.mes = d.getMonth();
      m.ano = d.getFullYear();
      mudouRes = true;
    }
  });
  if (mudouRes) salvarSaldoReserva(reserva);

  // Meta
  const meta = carregarDadosMeta();
  if (meta) {
    let mudouMeta = false;
    (meta.movimentos || []).forEach(m => {
      if (m.mes === undefined && m.data) {
        const d = new Date(m.data);
        m.mes = d.getMonth();
        m.ano = d.getFullYear();
        mudouMeta = true;
      }
    });
    if (mudouMeta) salvarDadosMeta(meta.valor, meta.mes, meta.ano, meta.categoria, meta.saldoAcumulado, meta.movimentos);
  }
})();
// Zera qualquer cobrir_previsao que possa ter ficado corrompido de versões anteriores
(function limparDadosLegados() {
  [2026,2027,2028,2029,2030].forEach(ano => {
    for (let m = 0; m < 12; m++) {
      const chave = "cobrir_previsao_" + ano + "_" + m;
      const val = parseFloat(localStorage.getItem(chave) || "0");
      // Se o valor gravado for absurdamente alto (>100k), é corrompido
      if (val > 100000) localStorage.removeItem(chave);
    }
  });
})();

/* ── ANO ATUAL ── */
const anos = [2026, 2027, 2028, 2029, 2030];
let anoAtual = (function() {
  const agora = new Date().getFullYear();
  return anos.includes(agora) ? agora : 2026;
})();
document.getElementById("ano-label").textContent = anoAtual;

/* ── DROPDOWN DE ANO ── */
(function() {
  const lista = document.getElementById("ano-dropdown-list");
  anos.forEach(ano => {
    const item = document.createElement("div");
    const dark = () => document.body.classList.contains("dark");
    const bgNormal  = () => dark() ? "#0d1845" : "#fff";
    const bgHover   = () => dark() ? "rgba(255,255,255,0.08)" : "#eef3fd";
    const bgAtivo   = () => dark() ? "rgba(255,255,255,0.14)" : "#e8effe";
    const corNormal = () => dark() ? "rgba(255,255,255,0.75)" : "#1a2a5e";
    const corAtivo  = () => dark() ? "#fff" : "#1c3f91";
    item.style.cssText = "padding:7px 18px;font-size:12px;font-family:inherit;cursor:pointer;text-align:center;white-space:nowrap;transition:background 0.1s,color 0.1s;";
    item.style.background = ano === anoAtual ? bgAtivo() : bgNormal();
    item.style.color = ano === anoAtual ? corAtivo() : corNormal();
    if (ano === anoAtual) item.style.fontWeight = "700";
    item.textContent = ano;
    item.addEventListener("mouseenter", () => { if (ano !== anoAtual) { item.style.background = bgHover(); item.style.color = corAtivo(); } });
    item.addEventListener("mouseleave", () => { if (ano !== anoAtual) { item.style.background = bgNormal(); item.style.color = corNormal(); } });
    item.addEventListener("click", () => {
      if (ano === anoAtual) { fecharAnoDropdown(); return; }
      clearTimeout(_changeMonthPendente);
      clearTimeout(_salvoDebounce);
      if (_indiceVisual === null) salvarMes();
      _indiceVisual = null; _anoVisual = null;
      anoAtual = ano;
      indice = 0;
      document.getElementById("titulomes").innerText = meses[0];
      document.getElementById("ano-label").textContent = anoAtual;
      atualizarEstiloItensAno();
      fecharAnoDropdown();
      animarTrocaAno(ano, () => {
        document.querySelectorAll(".val-input").forEach(i => i.value = "");
        document.querySelectorAll(".linha select").forEach(s => s.value = "");
        document.querySelectorAll(".linha input[type=checkbox]").forEach(c => c.checked = false);
        document.getElementById("sal1").value = "";
        document.getElementById("sal2").value = "";
        document.querySelectorAll(".linha").forEach(l => { l._subcategoria = ""; });
        carregarMes();
      });
    });
    lista.appendChild(item);
  });
})();

function toggleAnoDropdown() {
  const lista = document.getElementById("ano-dropdown-list");
  const chevron = document.getElementById("ano-chevron");
  const aberto = lista.style.display === "block";
  lista.style.display = aberto ? "none" : "block";
  chevron.style.transform = aberto ? "" : "rotate(180deg)";
  // Re-aplica cores dos itens conforme o tema atual
  if (!aberto) {
    const dark = document.body.classList.contains("dark");
    lista.querySelectorAll("div").forEach(item => {
      const isAtivo = item.textContent.trim() == anoAtual;
      item.style.background = isAtivo ? (dark ? "rgba(255,255,255,0.14)" : "#e8effe") : (dark ? "#0d1845" : "#fff");
      item.style.color      = isAtivo ? (dark ? "#fff" : "#1c3f91") : (dark ? "rgba(255,255,255,0.75)" : "#1a2a5e");
    });
  }
}

function animarTroca(texto, callback) {
  const overlay = document.getElementById("ano-flash-overlay");
  const label   = document.getElementById("ano-flash-label");
  label.textContent = texto;
  overlay.classList.remove("ativo");
  void overlay.offsetWidth;
  overlay.classList.add("ativo");
  return setTimeout(() => {
    overlay.classList.remove("ativo");
    if (callback) callback();
  }, 350);
}

function animarTrocaAno(ano, callback) { animarTroca(ano, callback); }

function fecharAnoDropdown() {
  document.getElementById("ano-dropdown-list").style.display = "none";
  document.getElementById("ano-chevron").style.transform = "";
}

document.addEventListener("click", function(e) {
  if (!document.getElementById("ano-dropdown-wrap").contains(e.target)) {
    fecharAnoDropdown();
  }
});

/* ── DROPDOWN DE MÊS ── */
(function() {
  const lista = document.getElementById("mes-dropdown-list");
  meses.forEach((nome, i) => {
    const item = document.createElement("div");
    const _mesHojeM = new Date().getMonth();
    const _anoHojeM  = new Date().getFullYear();
    item.className = "mes-dropdown-item" + (i === indice ? " ativo" : "") + (i === _mesHojeM && anoAtual === _anoHojeM ? " hoje" : "");
    item.textContent = nome;
    item.addEventListener("click", () => {
      if (i === indice) { fecharMesDropdown(); return; }
      clearTimeout(_changeMonthPendente);
      clearTimeout(_salvoDebounce);
      if (_indiceVisual === null) salvarMes();
      _indiceVisual = null; _anoVisual = null;
      indice = i;
      document.getElementById("titulomes").innerText = meses[indice];
      popupAvisoJaExibido = false;
      toastAvisoAtivo = false;
      _toastJaExibidoParaEsteSalario = false;
      atualizarAvisoIcone(false);
      fecharMesDropdown();
      animarTroca(meses[indice], () => {
        document.querySelectorAll(".val-input").forEach(inp => inp.value = "");
        document.querySelectorAll(".linha select").forEach(s => s.value = "");
        document.querySelectorAll(".linha input[type=checkbox]").forEach(c => c.checked = false);
        document.getElementById("sal1").value = "";
        document.getElementById("sal2").value = "";
        document.querySelectorAll(".linha").forEach(l => { l._subcategoria = ""; });
        carregarMes();
      });
    });
    lista.appendChild(item);
  });
})();

function toggleMesDropdown() {
  const lista = document.getElementById("mes-dropdown-list");
  const wrap = document.getElementById("mes-dropdown-wrap");
  const aberto = lista.classList.toggle("open");
  wrap.classList.toggle("aberto", aberto);
  const _mesHojeT = new Date().getMonth();
  const _anoHojeT  = new Date().getFullYear();
  lista.querySelectorAll(".mes-dropdown-item").forEach((el, i) => {
    el.classList.toggle("ativo", i === indice);
    el.classList.toggle("hoje", i === _mesHojeT && anoAtual === _anoHojeT);
  });
}

function fecharMesDropdown() {
  document.getElementById("mes-dropdown-list").classList.remove("open");
  document.getElementById("mes-dropdown-wrap").classList.remove("aberto");
}

document.addEventListener("click", function(e) {
  if (!document.getElementById("mes-dropdown-wrap").contains(e.target)) {
    fecharMesDropdown();
  }
});

/* ── COLETA todos os inputs editáveis da página ── */
function getInputs() {
  return [
    ...document.querySelectorAll(".val-input"),
    ...document.querySelectorAll(".coluna-wrapper .salario-input"),
    ...document.querySelectorAll(".linha select")
  ];
}

/* ── 12. SALVAR / CARREGAR MÊS ──────────────────────────────────────────
 *  Chave no localStorage: "planejamento_ANO_MES"  (ex: "planejamento_2026_0")
 *  Estrutura salva:
 *    { sal1, sal2,
 *      bw0_l0_sel, bw0_l0_val, bw0_l0_chk, bw0_l0_sub,
 *      bw0_l1_sel, ... }
 *  bwX = índice do bloco-wrap (.bloco-wrap); lX = índice da linha dentro dele.
 *
 *  salvarMes()    → grava estado atual (bloqueado se mês fechado ou em animação)
 *  carregarMes()  → restaura estado do localStorage e chama recalc()
 *  agendarSalvoComFeedback() → debounce de 3s, exibe "✓ Salvo" depois
 * ────────────────────────────────────────────────────────────────────── */
/* ── SALVAR / CARREGAR MÊS ──────────────────────────────────────────────
 *  Chave: "planejamento_ANO_MES" (ex: "planejamento_2026_0")
 *  Estrutura: { sal1, sal2, bw0_l0_sel, bw0_l0_val, bw0_l0_chk, bw0_l0_sub, ... }
 *  bwX = índice do .bloco-wrap; lX = índice da .linha dentro dele.
 *  salvarMes() → bloqueado se mês fechado ou em animação de troca.
 *  carregarMes() → restaura campos + chama recalc() + sincroniza dropdowns.
 *  agendarSalvoComFeedback() → debounce 3s, exibe "✓ Salvo" na topnav.
 * ────────────────────────────────────────────────────────────────────── */
/* ── SALVA dados do mês atual no LocalStorage ── */
function salvarMes() {
  // Impede gravação se o mês está bloqueado ou se a animação de troca está rodando
  if (mesFechado(anoAtual, indice)) return; // mês fechado — não permite alteração
  if (_indiceVisual !== null) return;        // tela em transição — campos foram limpos, não salva
  const chave = "planejamento_" + anoAtual + "_" + indice;
  const dados = {};

  dados.sal1 = document.getElementById("sal1")._valorBase || document.getElementById("sal1").value;
  dados.sal2 = document.getElementById("sal2")._valorBase || document.getElementById("sal2").value;

  document.querySelectorAll(".bloco-wrap").forEach((bw, bwIdx) => {
    bw.querySelectorAll(".linha").forEach((linha, lIdx) => {
      const sel  = linha.querySelector("select");
      const val  = linha.querySelector(".val-input");
      const chk  = linha.querySelector("input[type=checkbox]");
      const k    = `bw${bwIdx}_l${lIdx}`;
      dados[k + "_sel"] = sel  ? sel.value   : "";
      dados[k + "_val"] = val  ? val.value   : "";
      dados[k + "_chk"] = chk  ? chk.checked : false;
      dados[k + "_sub"] = linha._subcategoria || "";
    });
  });

  localStorage.setItem(chave, JSON.stringify(dados));
}

// Debounce: mostra "Salvo ✓" apenas 3s após a última alteração do usuário
let _salvoDebounce = null;
function agendarSalvoComFeedback() {
  clearTimeout(_salvoDebounce);
  _salvoDebounce = setTimeout(() => {
    salvarMes();
    const ind = document.getElementById("salvo-indicator");
    if (ind) {
      ind.classList.remove("saindo");
      ind.classList.add("visivel");
      clearTimeout(ind._hideTimer);
      ind._hideTimer = setTimeout(() => {
        ind.classList.add("saindo");
        setTimeout(() => { ind.classList.remove("visivel", "saindo"); }, 320);
      }, 4000);
    }
  }, 3000);
}

/* ── CARREGA dados do mês no LocalStorage ── */
function carregarMes() {
  const chave = "planejamento_" + anoAtual + "_" + indice;
  const raw   = localStorage.getItem(chave);

  // Limpa todos os campos primeiro
  document.querySelectorAll(".val-input").forEach(i => i.value = "");
  document.querySelectorAll(".linha select").forEach(s => {
    s.value = "";
    // Reseta display customizado imediatamente para evitar flash de cor errada
    if (s._customDisplay) {
      const d = s._customDisplay;
      d.style.background = "";
      d.style.color = "";
      d.style.borderColor = "";
      d.classList.remove("colored");
      d.childNodes.forEach(n => { if (n !== d._clearBtn) n.remove(); });
      d.insertBefore(document.createTextNode("Selecione"), d.firstChild);
      if (d._clearBtn) {
        d._clearBtn.classList.remove("visible");
        d._clearBtn.style.color = "";
      }
      d.classList.add("vazio");
    }
  });
  document.querySelectorAll(".linha input[type=checkbox]").forEach(c => c.checked = false);
  document.getElementById("sal1").value = "";
  document.getElementById("sal2").value = "";

  if (raw) {
    const dados = JSON.parse(raw);
    if (dados.sal1) document.getElementById("sal1").value = dados.sal1;
    if (dados.sal2) document.getElementById("sal2").value = dados.sal2;

    document.querySelectorAll(".bloco-wrap").forEach((bw, bwIdx) => {
      bw.querySelectorAll(".linha").forEach((linha, lIdx) => {
        const sel = linha.querySelector("select");
        const val = linha.querySelector(".val-input");
        const chk = linha.querySelector("input[type=checkbox]");
        const k   = `bw${bwIdx}_l${lIdx}`;
        if (sel && dados[k + "_sel"] !== undefined) sel.value     = dados[k + "_sel"];
        if (val && dados[k + "_val"] !== undefined) val.value     = dados[k + "_val"];
        if (chk && dados[k + "_chk"] !== undefined) chk.checked   = dados[k + "_chk"];
        // Restaura subcategoria
        linha._subcategoria = dados[k + "_sub"] || "";
        const btnSub = linha.querySelector(".btn-subcategoria-linha");
        if (btnSub) atualizarTooltipSubcategoria(btnSub, linha);
      });
    });
  }

  _extrasCarregarMes();
  recalc();
  sincronizarDropdownsBancos();
  document.querySelectorAll(".linha").forEach(linha => atualizarLinhaPaga(linha));
  atualizarDisplayReserva();
  atualizarBarraReserva();
  _aplicarEstadoMesFechado();

  // Atualiza diário se estiver ativo
  if (document.getElementById('view-diario').style.display !== 'none') {
    renderizarDiario();
  }
}

/* ── 13. TROCA DE MÊS / ANO ────────────────────────────────────────────
 *  changeMonth(d): avança (d=+1) ou recua (d=-1) o mês/ano.
 *  Usa animação de flash (animarTroca) para esconder a limpeza dos campos
 *  antes de carregar os dados do novo mês — o usuário nunca vê os campos
 *  zerados.
 *  _indiceVisual: enquanto a animação está ativa, salvarMes() é bloqueado
 *  para evitar gravar campos zerados.
 * ────────────────────────────────────────────────────────────────────── */
/* ── TROCA DE MÊS / ANO ────────────────────────────────────────────────
 *  changeMonth(d): avança (+1) ou recua (-1) um mês.
 *  Usa flash animado (animarTroca) para esconder a limpeza dos campos —
 *  o usuário nunca vê os campos zerados.
 *  _indiceVisual !== null indica que a tela está em transição: salvarMes()
 *  é bloqueado para evitar gravar os campos zerados.
 * ────────────────────────────────────────────────────────────────────── */
/* ── TROCA DE MÊS: salva o atual, carrega o novo ── */
let _changeMonthDebounce = null;
let _changeMonthPendente = 0;
let _indiceVisual = null;
let _anoVisual = null;

// Limites absolutos
const ANO_MIN = 2026, MES_MIN = 0;   // Janeiro 2026
const ANO_MAX = 2030, MES_MAX = 11;  // Dezembro 2030

function toastLimite(msg) {
  const id = "toast-limite-mes";
  let t = document.getElementById(id);
  if (!t) {
    t = document.createElement("div");
    t.id = id;
    t.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(10px);
      background:#1a2a5e;color:#fff;padding:11px 22px;border-radius:10px;font-size:13px;font-weight:600;
      font-family:'Outfit','Century Gothic',sans-serif;box-shadow:0 4px 20px rgba(28,63,145,0.35);
      z-index:99999;opacity:0;transition:opacity 0.22s ease,transform 0.22s ease;pointer-events:none;white-space:nowrap;`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  clearTimeout(t._hide);
  t.style.opacity = "1";
  t.style.transform = "translateX(-50%) translateY(0)";
  t._hide = setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(10px)";
  }, 2500);
}

function changeMonth(d){
  // 1. Cancela o carregarMes pendente de qualquer animação anterior
  clearTimeout(_changeMonthPendente);

  // 2. Só salva se os campos não foram limpos por um changeMonth anterior ainda em animação
  if (_indiceVisual === null) {
    clearTimeout(_salvoDebounce);
    salvarMes();
  }

  // 3. Calcula o novo mês/ano
  let novoMes = indice + d;
  let novoAno = anoAtual;
  if (novoMes < 0)  { novoAno--; novoMes = 11; }
  if (novoMes > 11) { novoAno++; novoMes = 0;  }

  // 4. Clamp nos limites
  if (novoAno < ANO_MIN || (novoAno === ANO_MIN && novoMes < MES_MIN)) {
    _indiceVisual = null; _anoVisual = null;
    toastLimite("📅 Você chegou ao início do histórico"); return;
  }
  if (novoAno > ANO_MAX || (novoAno === ANO_MAX && novoMes > MES_MAX)) {
    _indiceVisual = null; _anoVisual = null;
    toastLimite("📅 Você chegou ao fim do histórico"); return;
  }

  // 5. Atualiza o estado global
  anoAtual = novoAno;
  indice   = novoMes;
  _indiceVisual = novoMes; // marca que a tela está em transição
  _anoVisual    = novoAno;
  document.getElementById("ano-label").textContent = anoAtual;
  atualizarEstiloItensAno();
  popupAvisoJaExibido = false;
  toastAvisoAtivo = false;
  _toastJaExibidoParaEsteSalario = false;
  atualizarAvisoIcone(false);

  // 6. Anima: a limpeza dos campos acontece DENTRO do callback,
  //    enquanto o overlay está visível — o usuário nunca vê os campos zerados
  document.getElementById("titulomes").innerText = meses[indice];
  const _diarioMesLabel = document.getElementById('diario-mes-label');
  if (_diarioMesLabel) _diarioMesLabel.textContent = meses[indice] + ' ' + anoAtual;
  _atualizarDiarioTituloMes();
  _changeMonthPendente = animarTroca(meses[indice], () => {
    document.querySelectorAll(".val-input").forEach(i => i.value = "");
    document.querySelectorAll(".linha select").forEach(s => s.value = "");
    document.querySelectorAll(".linha input[type=checkbox]").forEach(c => c.checked = false);
    document.getElementById("sal1").value = "";
    document.getElementById("sal2").value = "";
    document.querySelectorAll(".linha").forEach(l => { l._subcategoria = ""; });
    _indiceVisual = null;
    _anoVisual    = null;
    carregarMes();
  });
}


function atualizarEstiloItensAno() {
  const lista = document.getElementById("ano-dropdown-list");
  lista.querySelectorAll("div").forEach((el, i) => {
    const a = anos[i];
    el.style.background = a === anoAtual ? "#e8effe" : "#fff";
    el.style.fontWeight  = a === anoAtual ? "700" : "400";
    el.style.color       = a === anoAtual ? "#1c3f91" : "#1a2a5e";
  });
}

function fmt(input){
  let digits = input.value.replace(/\D/g, "");
  if (!digits || parseInt(digits) === 0) { input.value = ""; return; }
  let v = (parseInt(digits) / 100).toFixed(2);
  v = v.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  input.value = "R$ " + v;
}

// Versão usada no oninput: formata mas não apaga zeros intermediários
// (permite editar "R$ 70.000,00" → apagar o 7 → sem resetar tudo)
function fmtInput(input){
  const val = input.value;
  const digits = val.replace(/\D/g, "");

  // Campo vazio: limpa
  if (!digits) { input.value = ""; return; }

  // Todos os dígitos são zero: não reformata, preserva o que está
  // (usuário apagou um dígito e ficaram zeros — blur vai limpar se confirmar)
  if (parseInt(digits) === 0) return;

  // Caso normal: reformata mantendo cursor
  const pos = input.selectionStart;
  let v = (parseInt(digits) / 100).toFixed(2);
  v = v.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  input.value = "R$ " + v;
  const diff = input.value.length - val.length;
  try { input.setSelectionRange(pos + diff, pos + diff); } catch(e) {}
}

let _movimentoMax    = Infinity;
let _movimentoMaxOriginal = 0;
let _movimentoDistInvertida = false; // depositar: true = bloco2 primeiro
let _movimentoDestino       = 1;     // retirar: 1 ou 2 (bloco destino)

function fmtMax(input) {
  fmtInput(input);
  const v = num(input.value);
  if (_movimentoMax < Infinity && v > _movimentoMax) {
    input.value = brl(_movimentoMax);
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch(e) {}
  }
}

// Garante que colagem também respeita o limite máximo
function _setupFmtMaxPaste(input) {
  if (input._pasteListenerAttached) return;
  input._pasteListenerAttached = true;
  input.addEventListener('paste', function() {
    setTimeout(function() { fmtMax(input); }, 0);
  });
}

function num(str){
  if(!str) return 0;
  return parseFloat(str.replace("R$ ","").replace(/\./g,"").replace(",",".")) || 0;
}

function brl(n){
  // Elimina -0 por imprecisão de ponto flutuante
  if (Object.is(n, -0) || (n < 0 && n > -0.005)) n = 0;
  return "R$ " + n.toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");
}

function pct(n){
  // Elimina -0 por imprecisão de ponto flutuante
  if (Object.is(n, -0) || (n < 0 && n > -0.005)) n = 0;
  return n.toFixed(2).replace(".",",") + "%";
}

/* ── SOMA BLOCO ── */
function somaBloco(totalId, blocoEl){
  let total = 0;
  blocoEl.querySelectorAll(".val-input").forEach(i => { total += num(i.value); });
  document.getElementById(totalId).textContent = brl(total);
  return total;
}

/* ── RECALC GERAL ── */
function verificarDuplicataLinha(inputVal) {
  // Validação movida para confirmarSubcategoria
}

/* ── 14. GAVETA DE TOTAL DO BLOCO ──────────────────────────────────────
 *  Ao clicar no valor ao lado do título do bloco (ex: "R$ 450,00"),
 *  aparece um painel tipo gaveta mostrando o subtotal detalhado.
 *  Fecha automaticamente após 5s.
 * ────────────────────────────────────────────────────────────────────── */

/* ── 14b. RECALC GERAL ──────────────────────────────────────────────────
 *  Chamado sempre que qualquer valor muda na tela.
 *  Fluxo:
 *    1. Soma cada bloco (Residência, Cartões, Outros) das 2 colunas
 *    2. Calcula subtotais e atualiza os círculos de progresso
 *    3. Calcula previsão de saldo = salário - gastos - ajuste (depósitos)
 *    4. Se há cobertura ativa e o déficit diminuiu, reverte o excedente
 *    5. Atualiza cards "Previsão de Saldo" e "Previsão de Gastos"
 *    6. Exibe/esconde ícone de aviso (!) se saldo negativo
 *    7. Verifica alerta de previsão configurado pelo usuário
 * ────────────────────────────────────────────────────────────────────── */
/* ── GAVETA DE TOTAL DO BLOCO ──────────────────────────────────────────
 *  Ao clicar no valor ao lado do título do bloco, abre um painel tipo
 *  gaveta com o subtotal. Fecha automaticamente após 5s.
 *
 * ── RECALC GERAL ─────────────────────────────────────────────────────
 *  Chamado sempre que qualquer valor muda.
 *  Fluxo: soma blocos → subtotais → previsão de saldo → atualiza cards
 *         → verifica cobertura ativa → exibe/esconde ícone de aviso (!)
 * ────────────────────────────────────────────────────────────────────── */
/* ── GAVETA DE TOTAL DO BLOCO ── */
const _gavetaTimers = {};

function toggleBlocoValor(totId) {
  const wrap = document.getElementById("wrap-" + totId);
  if (!wrap) return;
  const isAberto = wrap.classList.contains("aberto");

  if (isAberto) {
    // Durante o tour não fecha ao clicar — tour controla o estado
    if (document.body.classList.contains('tour-ativo')) return;
    wrap.classList.remove("aberto");
    clearTimeout(_gavetaTimers[totId]);
    return;
  }

  // Atualiza valor da gaveta
  const totEl = document.getElementById(totId);
  const gavEl = document.getElementById("gav-" + totId);
  if (totEl && gavEl) gavEl.textContent = totEl.textContent;

  wrap.classList.add("aberto");

  clearTimeout(_gavetaTimers[totId]);
  // Durante o tour não agenda o auto-close
  if (!document.body.classList.contains('tour-ativo')) {
    _gavetaTimers[totId] = setTimeout(() => {
      wrap.classList.remove("aberto");
    }, 5000);
  }
}

function recalc(fromSalary = false, fromUser = false){
  // fromSalary: true quando chamado ao confirmar salário → força toast de aviso
  // fromUser:   true quando o usuário editou algo → agenda salvo com feedback
  // Blocos coluna 1
  const colunas = document.querySelectorAll(".coluna-wrapper");
  const blocos1 = colunas[0] ? colunas[0].querySelectorAll(".bloco-wrap") : [];
  const r1 = somaColBloco("tot1-res", blocos1[0]);
  const c1 = somaColBloco("tot1-cart", blocos1[1]);
  const e1 = somaColBloco("tot1-emp", blocos1[2]);

  // Blocos coluna 2
  const blocos2 = colunas[1] ? colunas[1].querySelectorAll(".bloco-wrap") : [];
  const r2 = somaColBloco("tot2-res", blocos2[0]);
  const c2 = somaColBloco("tot2-cart", blocos2[1]);
  const e2 = somaColBloco("tot2-emp", blocos2[2]);

  const sub1 = r1 + c1 + e1;
  const sub2 = r2 + c2 + e2;
  // textContent atualizado depois, com alocação do diário incluída (ver sub1ComAloc)

  const sal1 = num(document.getElementById("sal1").value);
  const sal2 = num(document.getElementById("sal2").value);
  const totalSal = sal1 + sal2;
  document.getElementById("sal-total").value = totalSal > 0 ? brl(totalSal) : "";

  // Atualiza barra de progresso dos subtotais
  // Atualiza a barra circular SVG (stroke-dashoffset) proporcional ao gasto vs salário.
  // Fica vermelha quando > 90% do salário está comprometido.
  function _atualizarProgressoSubtotal(ringId, subtotal, salario) {
    const ring = document.getElementById(ringId);
    if (!ring) return;
    const CIRCUNFERENCIA = 301.59;
    const pct = salario > 0 ? Math.min(subtotal / salario, 1) : 0;
    const offset = CIRCUNFERENCIA - pct * CIRCUNFERENCIA;
    ring.style.strokeDashoffset = offset.toFixed(2);
    if (pct >= 0.9) {
      ring.classList.add("alerta");
    } else {
      ring.classList.remove("alerta");
    }
  }
  // Badge "Livre" abaixo de cada círculo — só aparece quando há salário informado
  function _atualizarBadgeLivre(badgeId, valId, salario, gasto) {
    const badge = document.getElementById(badgeId);
    const valEl = document.getElementById(valId);
    if (!badge || !valEl) return;
    const livre = salario - gasto;
    valEl.textContent = brl(livre);
    badge.classList.remove('oculto');
    const negativo = livre < 0;
    valEl.style.color      = negativo ? '#c0392b' : '#2e7d32';
    badge.style.borderColor = negativo ? 'rgba(192,57,43,0.22)' : 'rgba(46,125,50,0.18)';
    badge.style.background  = negativo ? 'rgba(192,57,43,0.08)' : 'rgba(46,125,50,0.09)';
    badge.style.color       = negativo ? '#c0392b' : '#3a6a3a';
  }
  // Desconta depósitos em reserva/meta e alocações para o diário do badge livre
  const _depRes  = parseFloat(localStorage.getItem('dep_reserva_' + anoAtual + '_' + indice) || '0');
  const _alocRaw = localStorage.getItem(_DIARIO_CHAVE_ALOCACAO);
  const _alocAll = _alocRaw ? JSON.parse(_alocRaw) : {};
  const _alocMes = _alocAll[anoAtual + '_' + indice] || {};
  const _alocE1  = parseFloat(_alocMes['1'] || 0);
  const _alocE2  = parseFloat(_alocMes['2'] || 0);
  // Reserva e meta descontam da entrada 1 primeiro; o restante vai para a entrada 2
  let _depMeta = 0;
  _META_KEYS.forEach(function(_, si) {
    _depMeta += parseFloat(localStorage.getItem('dep_meta_' + si + '_' + anoAtual + '_' + indice) || '0');
  });
  // Se há registro de blocos, usa o líquido deles (depB1+depB2-retB1-retB2 do mês atual)
  // para evitar que dep_reserva acumulado de meses anteriores inflacione o desconto.
  // Caso contrário, usa dep_reserva normalmente.
  const _blocosRawDesc = localStorage.getItem('mov_previsao_blocos_' + anoAtual + '_' + indice);
  const _blocosDesc = _blocosRawDesc ? JSON.parse(_blocosRawDesc) : null;
  const _temBlocosDesc = _blocosDesc && (_blocosDesc.depB1 + _blocosDesc.depB2 + _blocosDesc.retB1 + _blocosDesc.retB2) > 0.004;
  const _depResFinal = _temBlocosDesc
    ? Math.max(0, (_blocosDesc.depB1 - _blocosDesc.retB1)) + Math.max(0, (_blocosDesc.depB2 - _blocosDesc.retB2))
    : _depRes;
  const _totalDesconto = _depResFinal + _depMeta; // total a descontar nos badges

  // Lê distribuição de depósito/retirada por bloco definida pelo usuário
  const _blocosRaw = localStorage.getItem('mov_previsao_blocos_' + anoAtual + '_' + indice);
  const _blocos    = _blocosRaw ? JSON.parse(_blocosRaw) : {};
  // depB1/depB2: quanto do depósito (reserva+meta) saiu de cada bloco → desconta do livre
  // retB1/retB2: quanto da retirada entrou em cada bloco → soma no livre
  const _depB1 = parseFloat(_blocos.depB1 || 0);
  const _depB2 = parseFloat(_blocos.depB2 || 0);
  const _retB1 = parseFloat(_blocos.retB1 || 0);
  const _retB2 = parseFloat(_blocos.retB2 || 0);
  const _temBlocos = (_depB1 + _depB2 + _retB1 + _retB2) > 0.004;

  // Subtotais COM alocação do diário — usados na barra/anel e no valor exibido
  const sub1ComAloc = sub1 + _alocE1;
  const sub2ComAloc = sub2 + _alocE2;
  document.getElementById("sub1").textContent = brl(sub1ComAloc);
  document.getElementById("sub2").textContent = brl(sub2ComAloc);
  _atualizarProgressoSubtotal("sub1-ring", sub1ComAloc, sal1);
  _atualizarProgressoSubtotal("sub2-ring", sub2ComAloc, sal2);

  // Badge "!" — aparece quando há período ativo no Diário vinculado a esta entrada
  const _hintSub1 = document.getElementById('sub1-diario-hint');
  const _hintSub2 = document.getElementById('sub2-diario-hint');
  if (_hintSub1) _hintSub1.classList.toggle('visivel', _alocE1 > 0.004);
  if (_hintSub2) _hintSub2.classList.toggle('visivel', _alocE2 > 0.004);

  const _livreE1bruto = sal1 - sub1;
  const _livreE2bruto = sal2 - sub2;

  // Desconto líquido por bloco = depósitos que saíram - retiradas que entraram.
  // liqBX positivo → desconta do badge (depósito saiu deste bloco)
  // liqBX negativo → alivia o badge (retirada entrou neste bloco, mesmo sem depósito neste mês)
  const _liqB1 = _depB1 - _retB1;
  const _liqB2 = _depB2 - _retB2;
  const _totalBlocosDef = _liqB1 + _liqB2;

  let _descontoE1, _descontoE2;
  if (_temBlocos) {
    if (_liqB1 >= 0 && _liqB2 >= 0) {
      // Ambos positivos: desconto explícito por bloco + resto automático
      _descontoE1 = _liqB1;
      _descontoE2 = _liqB2;
      const _restoDesconto = Math.max(0, _totalDesconto - _totalBlocosDef);
      if (_restoDesconto > 0.004) {
        const _l1rest = Math.max(0, _livreE1bruto - _descontoE1);
        const _l2rest = Math.max(0, _livreE2bruto - _descontoE2);
        const _autoE1 = Math.min(_restoDesconto, _l1rest);
        const _autoE2 = Math.min(_restoDesconto - _autoE1, _l2rest);
        _descontoE1 += _autoE1;
        _descontoE2 += _autoE2;
      }
    } else {
      // Há retirada maior que depósito neste mês (ex: mês seguinte ao depósito).
      // liqBX negativo = o badge deste bloco cresce em |liqBX| (retirada alivia).
      // Usa liqBX diretamente no gasto: gasto negativo = badge aumenta além do sal-sub.
      _descontoE1 = _liqB1; // pode ser negativo → subtrai do gasto → aumenta livre
      _descontoE2 = _liqB2;
      // Resto do _totalDesconto sem bloco definido: automático bloco1-primeiro
      const _restoDesconto = Math.max(0, _totalDesconto - Math.max(0, _liqB1) - Math.max(0, _liqB2));
      if (_restoDesconto > 0.004) {
        const _l1rest = Math.max(0, _livreE1bruto - Math.max(0, _descontoE1));
        const _l2rest = Math.max(0, _livreE2bruto - Math.max(0, _descontoE2));
        const _autoE1 = Math.min(_restoDesconto, _l1rest);
        const _autoE2 = Math.min(_restoDesconto - _autoE1, _l2rest);
        _descontoE1 += _autoE1;
        _descontoE2 += _autoE2;
      }
    }
  } else {
    // Sem distribuição definida: automático bloco 1 primeiro
    _descontoE1 = Math.min(_totalDesconto, Math.max(0, _livreE1bruto));
    _descontoE2 = Math.min(_totalDesconto - _descontoE1, Math.max(0, _livreE2bruto));
  }

  // gasto inclui desconto (pode ser negativo quando liqBX < 0, aumentando o livre)
  const _gastoE1 = sub1 + _alocE1 + _descontoE1;
  const _gastoE2 = sub2 + _alocE2 + _descontoE2;
  _atualizarBadgeLivre('sub1-livre', 'sub1-livre-val', sal1, _gastoE1);
  _atualizarBadgeLivre('sub2-livre', 'sub2-livre-val', sal2, _gastoE2);

  const totalGastos    = sub1 + sub2 + _alocE1 + _alocE2; // inclui alocação do diário
  const chaveAdj       = "mov_previsao_"  + anoAtual + "_" + indice;
  const chaveCobertura = "cobrir_valor_"  + anoAtual + "_" + indice;
  const coberturaTotal = parseFloat(localStorage.getItem(chaveCobertura) || "0");

  // ajuste = depósitos/retiradas manuais na reserva/meta (mov_previsao)
  const ajuste = parseFloat(localStorage.getItem(chaveAdj) || "0");
  const deficitReal = totalSal - totalGastos - ajuste;

  // Se há cobertura ativa e o déficit real diminuiu, reverte o excedente
  if (coberturaTotal > 0) {
    // O ajuste (mov_previsao) inclui o efeito do saque da cobertura (-coberturaTotal).
    // Para saber o déficit real SEM a cobertura, neutralizamos esse efeito:
    // deficitSemCobrir = totalSal - totalGastos - (ajuste + coberturaTotal)
    // Isso representa o déficit que existia antes de qualquer saque da reserva para cobrir.
    const deficitSemCobrir = totalSal - totalGastos - (ajuste + coberturaTotal);
    const coberturaNecessaria = Math.max(0, -deficitSemCobrir);
    const coberturaExcedente = coberturaTotal - coberturaNecessaria;
    if (coberturaExcedente > 0.004) {
      _reverterCoberturaParcial(coberturaExcedente);
    }
  }

  // coberturaTotal e ajuste relidos após possível reversão parcial acima
  // (a reversão atualiza mov_previsao_ no localStorage, então precisamos reler)
  const coberturaAtual = parseFloat(localStorage.getItem(chaveCobertura) || "0");
  const ajusteAtual = parseFloat(localStorage.getItem(chaveAdj) || "0");
  const deficitFinal = totalSal - totalGastos - ajusteAtual;
  const deficitOriginal = totalSal - totalGastos - (ajusteAtual + coberturaAtual);
  const cobEfetiva = (coberturaAtual > 0 && deficitFinal < 0 && coberturaAtual >= Math.abs(deficitOriginal)) ? Math.abs(deficitOriginal) : 0;
  const previsaoSaldo = deficitFinal + cobEfetiva;
  _previsaoSaldoCache = previsaoSaldo; // atualiza cache para uso do Diário
  const gastoPct = totalSal > 0 ? (totalGastos / totalSal) * 100 : 0;
  // previsaoPct é puramente (salário - gastos) / salário — não inclui ajuste de reserva/meta nem cobertura
  const previsaoPct  = totalSal > 0 ? ((totalSal - totalGastos) / totalSal) * 100 : 0;

  document.getElementById("p-previsao").textContent  = brl(previsaoSaldo);
  document.getElementById("p-econpct").textContent   = pct(previsaoPct);
  const corPrevisao = previsaoSaldo < -0.005 ? "vermelho" : "verde";
  document.getElementById("p-previsao").className = "previsao-card-valor " + corPrevisao;
  document.getElementById("p-econpct").className  = "previsao-card-pct "  + corPrevisao;
  _verificarAlertaPrevisao(previsaoPct, totalSal);
  document.getElementById("p-total").className     = "previsao-card-valor vermelho";
  document.getElementById("p-gastospct").className = "previsao-card-pct vermelho";
  document.getElementById("p-total").textContent     = brl(totalGastos);
  document.getElementById("p-gastospct").textContent = pct(gastoPct);


  // Ícone de aviso se previsão de saldo negativa (inclui depósitos na reserva/meta)
  const _naDiario = document.getElementById('view-diario') && document.getElementById('view-diario').style.display !== 'none';
  if (totalSal > 0 && previsaoSaldo < -0.005) {
    if (!_naDiario) {
      if (fromSalary) exibirToastAviso(true);
      else exibirPopupAviso();
    }
    atualizarAvisoIcone(true);
    _atualizarBotaoTooltip();
  } else {
    atualizarAvisoIcone(false);
    _atualizarBotaoTooltip();
  }

  // Agenda salvo com feedback apenas quando o usuário editou algo
  if (fromUser) agendarSalvoComFeedback();

}

function somaColBloco(id, blocoWrap){
  if(!blocoWrap) return 0;
  let t = 0;
  blocoWrap.querySelectorAll(".val-input").forEach(i => t += num(i.value));
  document.getElementById(id).textContent = brl(t);
  return t;
}


/* ── 15. RESERVA DE EMERGÊNCIA ─────────────────────────────────────────
 *  Chave: localStorage("reserva_saldo_v1") → { saldo, movimentos[] }
 *  Cada movimento: { acao: "depositar"|"retirar", valor, data, mes, ano, origem? }
 *  origem: "cobrir-deficit" → saque automático para cobrir déficit
 *          "cobrir-deficit-estorno" → devolução ao diminuir gastos
 *          undefined → movimento manual do usuário
 *
 *  calcularSaldoAteMes(movs, ano, mes) → saldo acumulado até aquele mês
 *  calcularSaldoDisponivelParaSaque()  → considera saques em meses FUTUROS
 *    que já consumiram o saldo — bloqueia retirada se não sobrar nada
 * ────────────────────────────────────────────────────────────────────── */
/* ── RESERVA DE EMERGÊNCIA ─────────────────────────────────────────────
 *  Chave: "reserva_saldo_v1" → { saldo, movimentos[] }
 *  movimento: { acao, valor, data, mes, ano, origem? }
 *  origem: undefined = manual | "cobrir-deficit" = automático
 *  calcularSaldoAteMes(): saldo até o mês visualizado
 *  calcularSaldoDisponivelParaSaque(): desconta saques de meses futuros
 * ────────────────────────────────────────────────────────────────────── */
/* ── RESERVA DE EMERGÊNCIA — SALDO ACUMULADO ── */

function carregarSaldoReserva() {
  const raw = localStorage.getItem("reserva_saldo_v1");
  return raw ? JSON.parse(raw) : { saldo: 0, movimentos: [] };
}

function salvarSaldoReserva(dados) {
  localStorage.setItem("reserva_saldo_v1", JSON.stringify(dados));
}

function calcularSaldoAteMes(movimentos, ano, mes) {
  // Soma todos os movimentos com data <= (ano, mes).
  // Usado para mostrar o saldo acumulado até o mês visualizado.
  let saldo = 0;
  (movimentos || []).forEach(m => {
    if (m.ano === undefined || m.mes === undefined) return;
    if (m.ano < ano || (m.ano === ano && m.mes <= mes)) {
      saldo += m.acao === "depositar" ? m.valor : -m.valor;
    }
  });
  return Math.max(0, saldo);
}

// Calcula o saldo real considerando TODOS os movimentos (incluindo futuros ao mês visualizado).
// Usado para bloquear retiradas em meses passados quando o saldo já foi sacado depois.
function calcularSaldoReal(movimentos) {
  let saldo = 0;
  (movimentos || []).forEach(m => {
    saldo += m.acao === "depositar" ? m.valor : -m.valor;
  });
  return Math.max(0, saldo);
}

// Calcula quanto ainda pode ser sacado no mês visualizado (ano, mes).
// Agrupa movimentos posteriores por mês (calculando o líquido de cada mês)
// e simula cronologicamente: se o saldo parcial mensal acumulado ficar negativo,
// esse déficit foi coberto pelo saldo acumulado até o mês visualizado.
// Agrupar por mês é essencial: uma devolução no mesmo mês de um saque
// deve cancelar o impacto daquele saque sobre meses anteriores.
function calcularSaldoDisponivelParaSaque(movimentos, ano, mes) {
  const ateMes = calcularSaldoAteMes(movimentos, ano, mes);

  // Agrupa movimentos estritamente posteriores por (ano, mes) e calcula líquido de cada mês
  var mapaLiquido = {};
  (movimentos || []).forEach(function(m) {
    if (m.ano === undefined || m.mes === undefined) return;
    var eDepois = m.ano > ano || (m.ano === ano && m.mes > mes);
    if (!eDepois) return;
    var key = m.ano + '_' + m.mes;
    if (!mapaLiquido[key]) mapaLiquido[key] = { ano: m.ano, mes: m.mes, liquido: 0 };
    mapaLiquido[key].liquido += m.acao === "depositar" ? m.valor : -m.valor;
  });

  // Ordena os meses futuros cronologicamente e simula o saldo parcial acumulado
  var mesesOrdenados = Object.values(mapaLiquido)
    .sort(function(a, b) { return (a.ano * 12 + a.mes) - (b.ano * 12 + b.mes); });

  var saldoParcial = 0;
  var minimoSaldoParcial = 0;
  mesesOrdenados.forEach(function(m) {
    saldoParcial += m.liquido;
    if (saldoParcial < minimoSaldoParcial) minimoSaldoParcial = saldoParcial;
  });

  var consumidoDoPassado = Math.max(0, -minimoSaldoParcial);
  return Math.max(0, ateMes - consumidoDoPassado);
}

function atualizarDisplayReserva() {
  const dados = carregarSaldoReserva();
  const el = document.getElementById("res-saldo-display");
  if (!el) return;
  const movs = dados.movimentos || [];
  // Só mostra saldo se havia movimentos até este mês
  const temMovimentoAteAgora = movs.some(m =>
    m.ano < anoAtual || (m.ano === anoAtual && m.mes <= indice)
  );
  const saldo = temMovimentoAteAgora
    ? calcularSaldoAteMes(movs, anoAtual, indice)
    : 0;
  el.textContent = brl(saldo);
  el.style.color = saldo > 0 ? "#1f7a1f" : "#1a2a5e";
  el.classList.toggle("verde", saldo > 0);
}

/* ── 16. POPUP MOVIMENTO (DEPOSITAR / RETIRAR) ──────────────────────────
 *  Abre ao clicar nos botões "+ Depositar" / "− Retirar" no card de
 *  Reserva ou Meta. Validações:
 *    • Depósito: limitado à previsão de saldo disponível no mês
 *    • Retirada: requer fechamento de todos os meses anteriores;
 *                limitada ao saldoDisponível (descontando retiradas futuras)
 *  O movimento é salvo nos movimentos[] da reserva/meta e um ajuste é
 *  registrado em "mov_previsao_ANO_MES" para refletir na previsão de saldo.
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP MOVIMENTO (DEPOSITAR / RETIRAR) ──────────────────────────────
 *  Depósito: limitado à previsão de saldo disponível no mês.
 *  Retirada: requer fechamento de meses anteriores; limitada ao saldo
 *    disponível descontando retiradas em meses futuros.
 *  O movimento é salvo nos movimentos[] e registrado em mov_previsao_ANO_MES.
 * ────────────────────────────────────────────────────────────────────── */
/* ── POPUP MOVIMENTO (depositar / retirar) ── */
let _movimentoTipo   = ""; // 'reserva' ou 'meta'
let _movimentoAcao   = ""; // 'depositar' ou 'retirar'

/* ── 17. SISTEMA DE FILA DE TOASTS ─────────────────────────────────────
 *  Dois tipos de toast:
 *    exibirToastSaldo(msg): toast vermelho no canto superior-direito,
 *      empilha se já houver outro ativo — cada um tem barra de progresso
 *    exibirToastInfo(msg): toast azul centralizado no fundo, sobrescreve
 *      o anterior (usado para confirmações de ação bem-sucedida)
 * ────────────────────────────────────────────────────────────────────── */
/* ── SISTEMA DE FILA DE TOASTS ─────────────────────────────────────────
 *  exibirToastSaldo(msg): toast vermelho superior-direito, empilhável
 *  exibirToastInfo(msg):  toast azul centralizado no fundo, substitui anterior
 * ────────────────────────────────────────────────────────────────────── */
/* ── SISTEMA DE FILA DE TOASTS ── */
const _toastQueue = [];
const TOAST_GAP = 12; // espaço entre toasts em px

function _getToastTop() {
  let top = 60;
  // Inclui o toast-aviso fixo se estiver visível
  const aviso = document.getElementById("toast-aviso");
  if (aviso && aviso.classList.contains("visivel")) {
    top += aviso.offsetHeight + TOAST_GAP;
  }
  document.querySelectorAll(".toast-sistema").forEach(t => {
    top += t.offsetHeight + TOAST_GAP;
  });
  return top;
}

function _reposicionarToasts() {
  let top = 60;
  const aviso = document.getElementById("toast-aviso");
  if (aviso && aviso.classList.contains("visivel")) {
    top += aviso.offsetHeight + TOAST_GAP;
  }
  Array.from(document.querySelectorAll(".toast-sistema")).forEach(t => {
    t.style.top = top + "px";
    top += t.offsetHeight + TOAST_GAP;
  });
}

function exibirToastSaldo(msg, duracao) {
  duracao = duracao || 6000;
  // Se já existe um toast com a mesma mensagem, apenas reinicia o timer
  const existente = Array.from(document.querySelectorAll(".toast-sistema")).find(t => {
    const msgEl = t.querySelector(".toast-msg");
    return msgEl && msgEl.textContent === (msg || "Operação não permitida.");
  });
  if (existente) {
    clearTimeout(existente._hideTimer);
    // Reinicia a barra de progresso
    const bar = existente.querySelector(".toast-bar-sistema");
    if (bar) {
      bar.style.animation = "none";
      void bar.offsetWidth;
      bar.style.animation = `timer-shrink ${duracao}ms linear forwards`;
    }
    existente._hideTimer = setTimeout(() => _fecharToast(existente), duracao);
    return;
  }

  // Novo toast com mensagem diferente — empilha abaixo
  const toast = document.createElement("div");
  toast.className = "toast-sistema";
  toast.innerHTML = `
    <div class="toast-icone-wrap"><span>!</span></div>
    <div class="toast-corpo">
      <div class="toast-titulo">Atenção</div>
      <div class="toast-msg">${msg || "Operação não permitida."}</div>
    </div>
    <button class="toast-fechar" onclick="_fecharToast(this.closest('.toast-sistema'))">×</button>
    <div class="toast-bar-sistema"></div>`;
  const _isDark = document.body.classList.contains('dark');
  const _toastBg = _isDark ? '#1e3a6e' : '#fff';
  const _toastShadow = _isDark
    ? '0 4px 20px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.08)'
    : '0 4px 20px rgba(0,0,0,0.18),0 0 0 1px rgba(231,76,60,0.15)';
  toast.style.cssText = "position:fixed;right:20px;z-index:10002;background:" + _toastBg + ";border-radius:10px;" +
    "box-shadow:" + _toastShadow + ";" +
    "padding:12px 16px 10px;display:flex;align-items:flex-start;gap:10px;" +
    "width:320px;max-width:calc(100vw - 40px);opacity:0;overflow:hidden;" +
    "transform:translateX(110%);transition:opacity 0.3s ease,transform 0.3s cubic-bezier(0.34,1.2,0.64,1);";
  toast.style.top = _getToastTop() + "px";
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(0)";
  });

  const bar = toast.querySelector(".toast-bar-sistema");
  if (bar) {
    bar.style.cssText = "position:absolute;bottom:0;left:0;height:3px;" +
      "background:linear-gradient(to right,#e74c3c,#ff8a80);" +
      "border-radius:0 0 10px 10px;width:100%;transform-origin:left;" +
      "animation:timer-shrink " + (duracao/1000) + "s linear forwards;";
  }

  toast._hideTimer = setTimeout(() => _fecharToast(toast), duracao);
}

function _fecharToast(toast) {
  if (!toast || !toast.parentNode) return;
  clearTimeout(toast._hideTimer);
  toast.style.opacity = "0";
  toast.style.transform = "translateX(110%)";
  toast.style.transition = "opacity 0.25s ease, transform 0.25s ease";
  setTimeout(() => {
    toast.remove();
    _reposicionarToasts();
  }, 260);
}

function fecharToastSaldo() { /* legado */ }

/* ── TOAST INFO — centro-inferior, azul (fluxo de backup) ── */
function exibirToastInfo(msg, duracao) {
  duracao = duracao || 4000;
  const anterior = document.getElementById("toast-info-central");
  if (anterior) {
    anterior.style.opacity = "0";
    setTimeout(() => { if (anterior.parentNode) anterior.remove(); }, 200);
  }
  const toast = document.createElement("div");
  toast.id = "toast-info-central";
  toast.style.cssText =
    "position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(16px);" +
    "z-index:10010;background:linear-gradient(135deg,#1c3f91,#3a6edc);" +
    "border-radius:14px;box-shadow:0 8px 32px rgba(28,63,145,0.38),0 2px 8px rgba(28,63,145,0.18);" +
    "padding:13px 20px;display:inline-flex;align-items:center;justify-content:center;gap:10px;" +
    "max-width:420px;opacity:0;overflow:hidden;" +
    "transition:opacity 0.25s ease,transform 0.3s cubic-bezier(0.34,1.2,0.64,1);";
  toast.innerHTML =
    `<div style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>` +
    `<span style="font-size:13px;font-weight:600;color:#fff;line-height:1.45;white-space:nowrap;">${msg}</span>` +
    `<div style="position:absolute;bottom:0;left:0;height:3px;background:rgba(255,255,255,0.32);border-radius:0 0 14px 14px;width:100%;transform-origin:left;animation:timer-shrink ${duracao}ms linear forwards;"></div>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  }));
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(12px)";
    toast.style.transition = "opacity 0.25s ease,transform 0.25s ease";
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 280);
  }, duracao);
}

function getPrevisaoDisponivel() {
  const el = document.getElementById("p-previsao");
  return el ? num(el.textContent) : 0;
}


function _movimentoGetLivres() {
  const sal1 = num(document.getElementById('sal1').value);
  const sal2 = num(document.getElementById('sal2').value);
  const alocRaw = localStorage.getItem(_DIARIO_CHAVE_ALOCACAO);
  const alocAll = alocRaw ? JSON.parse(alocRaw) : {};
  const alocMes = alocAll[anoAtual + '_' + indice] || {};
  const alocE1  = parseFloat(alocMes['1'] || 0);
  const alocE2  = parseFloat(alocMes['2'] || 0);
  let sub1 = 0, sub2 = 0;
  document.getElementById('coluna1-wrapper') && document.getElementById('coluna1-wrapper').querySelectorAll('.val-input').forEach(function(i){ sub1 += num(i.value); });
  document.getElementById('coluna2-wrapper') && document.getElementById('coluna2-wrapper').querySelectorAll('.val-input').forEach(function(i){ sub2 += num(i.value); });
  // Replica a lógica do recalc para saber quanto de cada bloco já está comprometido.
  // Isso garante que um segundo depósito vai para o bloco correto sem sobrecarregar o mesmo,
  // e também funciona quando o salário muda (depB1/depB2 raw podem estar desatualizados).
  const _depRes2  = parseFloat(localStorage.getItem('dep_reserva_' + anoAtual + '_' + indice) || '0');
  let _depMetaT2 = 0;
  _META_KEYS.forEach(function(_, si) {
    _depMetaT2 += parseFloat(localStorage.getItem('dep_meta_' + si + '_' + anoAtual + '_' + indice) || '0');
  });
  const _blocosRaw2 = localStorage.getItem('mov_previsao_blocos_' + anoAtual + '_' + indice);
  const _blocos2 = _blocosRaw2 ? JSON.parse(_blocosRaw2) : {};
  const _depB12 = parseFloat(_blocos2.depB1 || 0), _depB22 = parseFloat(_blocos2.depB2 || 0);
  const _retB12 = parseFloat(_blocos2.retB1 || 0), _retB22 = parseFloat(_blocos2.retB2 || 0);
  const _liqB12 = _depB12 - _retB12, _liqB22 = _depB22 - _retB22;
  // Total líquido do mês: depósitos menos saques (não usa dep_reserva que acumula meses anteriores)
  const _totalDesc2 = Math.max(0, _depB12 - _retB12) + Math.max(0, _depB22 - _retB22) + _depMetaT2;
  const _temBlocos2 = (_depB12 + _depB22 + _retB12 + _retB22) > 0.004;
  const _l1b = sal1 - sub1 - alocE1;
  const _l2b = sal2 - sub2 - alocE2;
  let _jaE1 = 0, _jaE2 = 0;
  if (_temBlocos2) {
    if (_liqB12 >= 0 && _liqB22 >= 0) {
      _jaE1 = _liqB12; _jaE2 = _liqB22;
      const _r2 = Math.max(0, _totalDesc2 - _liqB12 - _liqB22);
      if (_r2 > 0.004) {
        const _a1 = Math.min(_r2, Math.max(0, _l1b - _jaE1));
        _jaE1 += _a1;
        _jaE2 += Math.min(_r2 - _a1, Math.max(0, _l2b - _jaE2));
      }
    } else {
      _jaE1 = Math.max(0, _liqB12); _jaE2 = Math.max(0, _liqB22);
      const _r2 = Math.max(0, _totalDesc2 - _jaE1 - _jaE2);
      if (_r2 > 0.004) {
        const _a1 = Math.min(_r2, Math.max(0, _l1b - _jaE1));
        _jaE1 += _a1;
        _jaE2 += Math.min(_r2 - _a1, Math.max(0, _l2b - _jaE2));
      }
    }
  } else {
    _jaE1 = Math.min(_totalDesc2, Math.max(0, _l1b));
    _jaE2 = Math.min(_totalDesc2 - _jaE1, Math.max(0, _l2b));
  }
  // Crédito cross-month: se liqBX < 0, esse bloco recebeu dinheiro da reserva
  // e pode devolvê-lo. O livre inclui esse crédito como capacidade de depósito.
  const _creditoE1 = Math.max(0, -_liqB12);
  const _creditoE2 = Math.max(0, -_liqB22);
  const livre1 = Math.max(0, _l1b - _jaE1) + _creditoE1;
  const livre2 = Math.max(0, _l2b - _jaE2) + _creditoE2;
  return { livre1, livre2 };
}

function _movimentoGetEspaco() {
  const depRes = parseFloat(localStorage.getItem('dep_reserva_' + anoAtual + '_' + indice) || '0');
  let depMeta = 0;
  _META_KEYS.forEach(function(_, si) {
    depMeta += parseFloat(localStorage.getItem('dep_meta_' + si + '_' + anoAtual + '_' + indice) || '0');
  });
  const totalDesconto = depRes + depMeta;
  const sal1 = num(document.getElementById('sal1').value);
  const sal2 = num(document.getElementById('sal2').value);
  let sub1 = 0, sub2 = 0;
  document.getElementById('coluna1-wrapper') && document.getElementById('coluna1-wrapper').querySelectorAll('.val-input').forEach(function(i){ sub1 += num(i.value); });
  document.getElementById('coluna2-wrapper') && document.getElementById('coluna2-wrapper').querySelectorAll('.val-input').forEach(function(i){ sub2 += num(i.value); });
  const l1b = sal1 - sub1, l2b = sal2 - sub2;
  const blocosRaw = localStorage.getItem('mov_previsao_blocos_' + anoAtual + '_' + indice);
  const blocos = blocosRaw ? JSON.parse(blocosRaw) : {};
  const retB1 = parseFloat(blocos.retB1 || 0), retB2 = parseFloat(blocos.retB2 || 0);

  const depB1 = parseFloat(blocos.depB1 || 0), depB2 = parseFloat(blocos.depB2 || 0);

  // Total líquido disponível para saque: usa depB1+depB2 (total bruto depositado nos blocos)
  // descontando apenas os saques já feitos. dep_reserva não é usado aqui pois decremente
  // no saque causaria dupla subtração com retB1/retB2.
  const totalDepositadoBlocos = depB1 + depB2 > 0.004 ? depB1 + depB2 : totalDesconto;
  const totalJaSacado = retB1 + retB2;
  const liqTotal = Math.max(0, totalDepositadoBlocos - totalJaSacado);

  // Regra de limite por bloco — aplica-se sempre que há registro de depósitos por bloco.
  // Mesmo sem dep_reserva deste mês (cross-month), os blocos podem ter depB1/depB2
  // de depósitos anteriores que ainda determinam o limite de saque.
  const temRegistroBlocos = (depB1 + depB2) > 0.004;

  if (temRegistroBlocos) {
    // saldoReal = saldo total disponível (inclui meses anteriores + mês atual)
    const saldoReal = (typeof _movimentoMaxOriginal !== 'undefined' && _movimentoMaxOriginal > 0)
      ? _movimentoMaxOriginal : liqTotal;
    // Líquido do mês atual por bloco
    const liqB1proprio = Math.max(0, depB1 - retB1);
    const liqB2proprio = Math.max(0, depB2 - retB2);
    const liqMesAtual = liqB1proprio + liqB2proprio;
    // Genérico = saldo de meses anteriores (sem restrição de bloco)
    const saldoGenerico = Math.max(0, saldoReal - liqMesAtual);
    // B1 pode receber: genérico + próprio do B1 no mês atual
    // B2 pode receber: tudo (sem restrição)
    return { espaco1: saldoGenerico + liqB1proprio, espaco2: saldoReal };
  }

  // Sem registro de blocos: cross-month puro ou primeiro depósito sem distribuição.
  // Dinheiro livre — pode ir para qualquer bloco.
  return { espaco1: Infinity, espaco2: Infinity };
}

function _movimentoAtualizarDistribuicao() {
  const valor = num(document.getElementById('popup-movimento-valor').value);
  const blocos = document.getElementById('popup-movimento-blocos');
  const dist   = document.getElementById('popup-movimento-dist');
  const dest   = document.getElementById('popup-movimento-dest');
  if (!blocos || !dist) return;

  if (valor <= 0) {
    blocos.style.display = 'none';
    return;
  }

  blocos.style.display = 'block';

  // Retirada: mostra painel de escolha de bloco destino (dest)
  // Depósito: mostra painel de distribuição automática (dist)
  if (_movimentoAcao === 'retirar') {
    dist.style.display = 'none';
    if (dest) {
      dest.style.display = 'block';
      const b2El = document.getElementById('popup-dest-b2');
      if (b2El) b2El.style.display = '';
      // Reaaplica estilo e limite do bloco ativo ao mostrar o painel
      _movimentoSelecionarDestino(_movimentoDestino || 1);
    }
    return;
  }

  // Depósito: distribuição automática
  dist.style.display = 'block';
  if (dest) dest.style.display = 'none';

  const { livre1, livre2 } = _movimentoGetLivres();
  const cap1 = livre1, cap2 = livre2;

  let d1, d2;
  if (!_movimentoDistInvertida) {
    d1 = Math.min(valor, cap1);
    d2 = Math.min(valor - d1, cap2);
  } else {
    d2 = Math.min(valor, cap2);
    d1 = Math.min(valor - d2, cap1);
  }

  document.getElementById('popup-dist-b1-val').textContent = brl(d1);
  document.getElementById('popup-dist-b2-val').textContent = brl(d2);

  const b1El = document.getElementById('popup-dist-b1');
  const b2El = document.getElementById('popup-dist-b2');
  const ativo   = 'border:1.5px solid rgba(58,110,220,0.5);background:rgba(58,110,220,0.1);';
  const inativo = 'border:1.5px solid rgba(58,110,220,0.12);background:rgba(58,110,220,0.02);';
  b1El.style.border = d1 > 0 ? '1.5px solid rgba(58,110,220,0.5)' : '1.5px solid rgba(58,110,220,0.12)';
  b1El.style.background = d1 > 0 ? 'rgba(58,110,220,0.1)' : 'rgba(58,110,220,0.02)';
  b2El.style.border = d2 > 0 ? '1.5px solid rgba(58,110,220,0.5)' : '1.5px solid rgba(58,110,220,0.12)';
  b2El.style.background = d2 > 0 ? 'rgba(58,110,220,0.1)' : 'rgba(58,110,220,0.02)';
  b1El.style.cursor = 'pointer';
  b2El.style.cursor = 'pointer';

  b1El.dataset.valor = d1.toFixed(2);
  b2El.dataset.valor = d2.toFixed(2);
}

function _movimentoInverterDist() {
  _movimentoDistInvertida = !_movimentoDistInvertida;
  _movimentoAtualizarDistribuicao();
}

function _movimentoSelecionarDestino(bloco) {
  const b1 = document.getElementById('popup-dest-b1');
  const b2 = document.getElementById('popup-dest-b2');
  if (!b1 || !b2) return;

  // Verifica espaço disponível por bloco
  const { espaco1, espaco2 } = _movimentoGetEspaco();

  // Se o bloco clicado não tem espaço, ignora o clique
  if (bloco === 1 && espaco1 <= 0) return;
  if (bloco === 2 && espaco2 <= 0) return;

  _movimentoDestino = bloco;

  // Desabilita visualmente o bloco sem espaço
  if (espaco1 <= 0) {
    b1.style.border = '1.5px solid rgba(180,180,180,0.3)';
    b1.style.background = 'rgba(180,180,180,0.05)';
    b1.style.opacity = '0.4';
    b1.style.cursor = 'not-allowed';
  } else {
    b1.style.opacity = '';
    b1.style.cursor = '';
  }
  if (espaco2 <= 0) {
    b2.style.border = '1.5px solid rgba(180,180,180,0.3)';
    b2.style.background = 'rgba(180,180,180,0.05)';
    b2.style.opacity = '0.4';
    b2.style.cursor = 'not-allowed';
  } else {
    b2.style.opacity = '';
    b2.style.cursor = '';
  }

  // Estilo ativo/inativo
  if (bloco === 1) {
    b1.style.border = '1.5px solid rgba(58,110,220,0.5)';
    b1.style.background = 'rgba(58,110,220,0.1)';
    b2.style.border = espaco2 <= 0 ? '1.5px solid rgba(180,180,180,0.3)' : '1.5px solid rgba(58,110,220,0.12)';
    b2.style.background = espaco2 <= 0 ? 'rgba(180,180,180,0.05)' : 'rgba(58,110,220,0.02)';
  } else {
    b2.style.border = '1.5px solid rgba(58,110,220,0.5)';
    b2.style.background = 'rgba(58,110,220,0.1)';
    b1.style.border = espaco1 <= 0 ? '1.5px solid rgba(180,180,180,0.3)' : '1.5px solid rgba(58,110,220,0.12)';
    b1.style.background = espaco1 <= 0 ? 'rgba(180,180,180,0.05)' : 'rgba(58,110,220,0.02)';
  }
  // Cursor pointer nos blocos habilitados
  b1.style.cursor = espaco1 <= 0 ? 'not-allowed' : 'pointer';
  b2.style.cursor = espaco2 <= 0 ? 'not-allowed' : 'pointer';

  // Atualiza o limite máximo do campo de valor para o bloco selecionado
  const maxBloco = bloco === 1 ? espaco1 : espaco2;
  // novoMax = menor entre o saldo total da reserva e o espaço do bloco
  // Usa _movimentoMaxOriginal para não acumular reduções ao trocar de bloco
  const _saldoTotal = (typeof _movimentoMaxOriginal !== 'undefined' && _movimentoMaxOriginal > 0)
    ? _movimentoMaxOriginal : _movimentoMax;
  const novoMax = isFinite(maxBloco) ? Math.min(_saldoTotal, maxBloco) : _saldoTotal;
  // Atualiza _movimentoMax para que sacarTudo use o limite correto do bloco
  _movimentoMax = novoMax;
  const maxEl = document.getElementById('popup-movimento-max');
  if (maxEl) {
    maxEl.textContent = `Valor máximo: ${brl(novoMax)}`;
    maxEl.style.display = 'block';
  }
  // Ajusta o valor digitado se exceder o novo limite
  const inp = document.getElementById('popup-movimento-valor');
  if (inp) {
    const valorAtual = num(inp.value);
    if (valorAtual > novoMax + 0.004) {
      inp.value = brl(novoMax);
      inp.dispatchEvent(new Event('input'));
    }
  }
}

function abrirPopupMovimento(tipo, acao) {
  if (mesFechado(anoAtual, indice)) {
    exibirToastSaldo("Este mês está fechado. Reabra-o para fazer movimentações.");
    return;
  }
  const _x_popup_movimento = document.getElementById("x-popup-movimento"); if (_x_popup_movimento) _x_popup_movimento.style.display = "flex";
  _movimentoTipo = tipo;
  _movimentoAcao = acao;

  // Bloqueia depósito se não há previsão de saldo disponível
  if (acao === "depositar") {
    const disponivel = getPrevisaoDisponivel();
    if (disponivel <= 0) {
      exibirToastSaldo("Sem previsão de saldo disponível para depositar.");
      return;
    }
  }

  // Bloqueia retirada se não há saldo disponível para o mês visualizado,
  // descontando retiradas futuras que consumiram saldo acumulado até este mês.
  if (acao === "retirar") {
    // Regra: só pode sacar se todos os meses anteriores estiverem fechados
    if (!_todosAnterioresFechados(anoAtual, indice)) {
      const nomeAberto = _ultimoMesAberto(anoAtual, indice);
      exibirToastSaldo(`Para sacar, realize o fechamento contábil em ${nomeAberto} — meses em aberto anteriores também serão fechados automaticamente.`);
      return;
    }

    let saldoDisponivel = 0;
    if (tipo === "reserva") {
      const dados = carregarSaldoReserva();
      const movs = dados.movimentos || [];
      saldoDisponivel = movs.length > 0 ? calcularSaldoDisponivelParaSaque(movs, anoAtual, indice) : (dados.saldo || 0);
    } else {
      const dados = carregarDadosMeta();
      if (dados) {
        const movs = dados.movimentos || [];
        saldoDisponivel = movs.length > 0 ? calcularSaldoDisponivelParaSaque(movs, anoAtual, indice) : num(dados.saldoAcumulado || "R$ 0,00");
      }
    }
    if (saldoDisponivel <= 0) {
      const nomeCard = tipo === "reserva" ? "reserva de emergência" : "meta";
      // Verifica se o saldo é 0 por causa de saques futuros ou simplesmente porque está vazio
      let saldoAtual = 0;
      if (tipo === "reserva") {
        const _dadosRes = carregarSaldoReserva();
        saldoAtual = calcularSaldoAteMes(_dadosRes.movimentos || [], anoAtual, indice);
      } else {
        const _dadosMeta = carregarDadosMeta();
        if (_dadosMeta) saldoAtual = calcularSaldoAteMes(_dadosMeta.movimentos || [], anoAtual, indice);
      }
      if (saldoAtual <= 0) {
        exibirToastSaldo(`A ${nomeCard} está vazia. Deposite antes de tentar sacar.`);
      } else {
        exibirToastSaldo(`O saldo da ${nomeCard} já foi utilizado em meses seguintes. Não há valor disponível para saque neste mês.`);
      }
      return;
    }
  }

  const iconeDepositar = `<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,rgba(28,63,145,0.1),rgba(58,110,220,0.15));display:flex;align-items:center;justify-content:center;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1c3f91" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><polyline points="8 12 12 16 16 12"/></svg></div>`;
  const iconeRetirar   = `<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,rgba(192,57,43,0.08),rgba(231,76,60,0.14));display:flex;align-items:center;justify-content:center;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="8"/><polyline points="8 12 12 8 16 12"/></svg></div>`;
  const icone   = acao === "depositar" ? iconeDepositar : iconeRetirar;
  const corBtn  = acao === "depositar"
    ? "linear-gradient(135deg,#1c3f91,#3a6edc)"
    : "linear-gradient(135deg,#c0392b,#e74c3c)";
  const nomeCard = tipo === "reserva" ? "sua reserva de emergência" : "sua meta";
  const acao_label = acao === "depositar" ? "Deposite em" : "Retirar da";

  document.getElementById("popup-movimento-icone").innerHTML   = icone;
  document.getElementById("popup-movimento-titulo").textContent  = acao === "depositar" ? "Depositar" : "Retirar";
  // Atualiza label do painel de distribuição conforme ação
  const _distLabel = document.getElementById('popup-dist-label');
  if (_distLabel) _distLabel.textContent = acao === "depositar" ? "Saindo de" : "Entrando em";
  document.getElementById("popup-movimento-sub").textContent     = acao_label + " " + nomeCard;
  document.getElementById("popup-movimento-confirmar").style.background = corBtn;
  document.getElementById("popup-movimento-valor").value = "";

  // Mostra o valor máximo permitido abaixo do input
  const maxEl = document.getElementById("popup-movimento-max");
  if (acao === "depositar") {
    const disponivel = getPrevisaoDisponivel();
    _movimentoMax = disponivel;
    if (maxEl) { maxEl.textContent = `Valor máximo: ${brl(disponivel)}`; maxEl.style.display = "block"; }
  } else {
    let saldoDisponivel = 0;
    if (tipo === "reserva") {
      const dados = carregarSaldoReserva();
      const movs = dados.movimentos || [];
      saldoDisponivel = movs.length > 0 ? calcularSaldoDisponivelParaSaque(movs, anoAtual, indice) : (dados.saldo || 0);
    } else {
      const dados = carregarDadosMeta();
      if (dados) {
        const movs = dados.movimentos || [];
        saldoDisponivel = movs.length > 0 ? calcularSaldoDisponivelParaSaque(movs, anoAtual, indice) : num(dados.saldoAcumulado || "R$ 0,00");
      }
    }
    _movimentoMax = saldoDisponivel;
    _movimentoMaxOriginal = saldoDisponivel;
    // Calcula o espaço por bloco e seleciona o maior
    const { espaco1: _esp1, espaco2: _esp2 } = _movimentoGetEspaco();
    const _blocoInicial = (_esp1 >= _esp2) ? 1 : 2;
    // Calcula novoMax diretamente aqui para o display (sem depender de _movimentoSelecionarDestino)
    const _maxBlocoInicial = _blocoInicial === 1 ? _esp1 : _esp2;
    const _novoMaxInicial = isFinite(_maxBlocoInicial)
      ? Math.min(saldoDisponivel, _maxBlocoInicial)
      : saldoDisponivel;
    _movimentoMax = _novoMaxInicial;
    _movimentoDestino = _blocoInicial; // garante que input/sacarTudo usem o bloco correto
    _movimentoSelecionarDestino(_blocoInicial);
    if (maxEl) { maxEl.textContent = `Valor máximo: ${brl(_novoMaxInicial)}`; maxEl.style.display = 'block'; }
  }

  // Mostra botão "Sacar tudo" apenas ao retirar
  const btnSacarTudo     = document.getElementById("popup-movimento-sacar-tudo");
  const btnDepositarTudo = document.getElementById("popup-movimento-depositar-tudo");
  if (btnSacarTudo)     btnSacarTudo.style.display     = (acao === "retirar")  ? "inline-block" : "none";
  if (btnDepositarTudo) btnDepositarTudo.style.display  = (acao === "depositar") ? "inline-block" : "none";

  // Inicializa painel de blocos — limpa estado anterior
  _movimentoDistInvertida = false;
  // _movimentoDestino já foi definido pelo _blocoInicial acima — não resetar aqui
  const blocos = document.getElementById('popup-movimento-blocos');
  const dist   = document.getElementById('popup-movimento-dist');
  const dest   = document.getElementById('popup-movimento-dest');
  if (blocos) blocos.style.display = 'none';
  if (dist)   dist.style.display   = 'none';
  if (dest)   dest.style.display   = 'none';
  // Limpa dataset.valor dos cards de distribuição para evitar lixo entre operações
  const _b1El = document.getElementById('popup-dist-b1');
  const _b2El = document.getElementById('popup-dist-b2');
  if (_b1El) { _b1El.dataset.valor = '0'; document.getElementById('popup-dist-b1-val').textContent = brl(0); }
  if (_b2El) { _b2El.dataset.valor = '0'; document.getElementById('popup-dist-b2-val').textContent = brl(0); }

  if (acao === 'retirar' && blocos) {
    // Para retirada com 2 salários: usa painel de distribuição (igual ao depósito)
    // O oninput do campo de valor já chama _movimentoAtualizarDistribuicao
    // Não precisamos mostrar nada agora — aparece ao digitar o valor
  }
  if (acao === 'depositar' && blocos) {
    // Para depósito: painel aparece ao digitar também
  }

  const overlay = document.getElementById("popup-movimento-overlay");
  const popup   = document.getElementById("popup-movimento");
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => {
    popup.style.opacity       = "1";
    popup.style.transform     = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "auto";
    const _mvInp = document.getElementById("popup-movimento-valor"); _setupFmtMaxPaste(_mvInp); setTimeout(() => _mvInp.focus(), 150);
  });
}

function sacarTudo() {
  const inp = document.getElementById("popup-movimento-valor");
  if (!inp) return;
  // Recalcula o limite do bloco selecionado para garantir restrição correta
  // mesmo se o popup foi aberto sem digitar nada ainda
  if (_movimentoAcao === 'retirar') {
    const { espaco1, espaco2 } = _movimentoGetEspaco();
    const maxBloco = (_movimentoDestino === 2) ? espaco2 : espaco1;
    const limiteReal = isFinite(maxBloco)
      ? Math.min(_movimentoMaxOriginal || _movimentoMax, maxBloco)
      : (_movimentoMaxOriginal || _movimentoMax);
    if (limiteReal <= 0) return;
    // Atualiza _movimentoMax com o limite correto antes de preencher
    _movimentoMax = limiteReal;
    inp.value = brl(limiteReal);
  } else {
    if (_movimentoMax <= 0) return;
    inp.value = brl(_movimentoMax);
  }
  inp.dispatchEvent(new Event("input"));
}

function depositarTudo() {
  const inp = document.getElementById("popup-movimento-valor");
  if (!inp) return;
  // Usa o saldo disponível na reserva/meta correspondente ao tipo aberto
  const max = _movimentoMax < Infinity ? _movimentoMax : 0;
  if (max <= 0) { exibirToastSaldo("Sem saldo disponível para depositar."); return; }
  inp.value = brl(max);
  inp.dispatchEvent(new Event("input"));
  inp.style.borderColor = "#3a6edc";
  setTimeout(() => inp.style.borderColor = "", 800);
}

function fecharPopupMovimento() {
  const _x_popup_movimento = document.getElementById("x-popup-movimento"); if (_x_popup_movimento) _x_popup_movimento.style.display = "none";
  const overlay = document.getElementById("popup-movimento-overlay");
  const popup   = document.getElementById("popup-movimento");
  _movimentoMax = Infinity;
  _movimentoMaxOriginal = 0;
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.93)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    overlay.style.display = "none";
  }, 220);
}

function confirmarMovimento() {
  const valorStr = document.getElementById("popup-movimento-valor").value;
  let valor      = num(valorStr);

  if (!valor || valor <= 0) {
    const inp = document.getElementById("popup-movimento-valor");
    inp.style.borderColor = "#e74c3c";
    setTimeout(() => inp.style.borderColor = "", 1200);
    return;
  }

  // Se valor do depósito excede a previsão de saldo, limita ao máximo e continua
  if (_movimentoAcao === "depositar") {
    const disponivel = getPrevisaoDisponivel();
    if (valor > disponivel) {
      if (disponivel <= 0) {
        const inp = document.getElementById("popup-movimento-valor");
        inp.style.borderColor = "#e74c3c";
        setTimeout(() => inp.style.borderColor = "", 1200);
        return;
      }
      valor = disponivel;
    }
  }

  // Se valor da retirada excede o saldo disponível para o mês visualizado
  // (descontando retiradas futuras que consumiram saldo acumulado até este mês), limita e continua.
  if (_movimentoAcao === "retirar") {
    let saldoDisponivel = 0;
    if (_movimentoTipo === "reserva") {
      const dados = carregarSaldoReserva();
      const movs = dados.movimentos || [];
      saldoDisponivel = movs.length > 0 ? calcularSaldoDisponivelParaSaque(movs, anoAtual, indice) : (dados.saldo || 0);
    } else {
      const dados = carregarDadosMeta();
      if (dados) {
        const movs = dados.movimentos || [];
        saldoDisponivel = movs.length > 0 ? calcularSaldoDisponivelParaSaque(movs, anoAtual, indice) : num(dados.saldoAcumulado || "R$ 0,00");
      }
    }
    if (valor > saldoDisponivel) {
      if (saldoDisponivel <= 0) {
        const inp = document.getElementById("popup-movimento-valor");
        inp.style.borderColor = "#e74c3c";
        setTimeout(() => inp.style.borderColor = "", 1200);
        return;
      }
      valor = saldoDisponivel;
    }
  }

  if (_movimentoTipo === "reserva") {
    const dados = carregarSaldoReserva();
    dados.movimentos = dados.movimentos || [];
    dados.movimentos.push({ acao: _movimentoAcao, valor, data: new Date().toISOString(), mes: indice, ano: anoAtual });
    // Saldo flat sempre sincronizado com movimentos
    dados.saldo = calcularSaldoAteMes(dados.movimentos, anoAtual, indice);
    // Rastreio do mês: depósitos positivos, retiradas negativas
    const chaveDepRes = "dep_reserva_" + anoAtual + "_" + indice;
    const depResAtual = parseFloat(localStorage.getItem(chaveDepRes) || "0");
    const deltaRes = _movimentoAcao === "depositar" ? valor : -valor;
    localStorage.setItem(chaveDepRes, Math.max(0, depResAtual + deltaRes).toFixed(2));
    // Guarda quanto do saque veio de depósitos DESTE mês (antes do clamp)
    window._depResMesAntes = depResAtual; // usado logo abaixo no cálculo cross-month
    salvarSaldoReserva(dados);
    atualizarDisplayReserva();

  } else if (_movimentoTipo === "meta") {
    const dados = carregarDadosMeta();
    if (dados) {
      dados.movimentos = dados.movimentos || [];
      dados.movimentos.push({ acao: _movimentoAcao, valor, data: new Date().toISOString(), mes: indice, ano: anoAtual });
      // Saldo sempre calculado via movimentos — única fonte de verdade
      dados.saldoAcumulado = brl(calcularSaldoAteMes(dados.movimentos, anoAtual, indice));
      // Rastreio do mês por slot
      const chaveSlot = "dep_meta_" + _metaIdx + "_" + anoAtual + "_" + indice;
      const depAtual = parseFloat(localStorage.getItem(chaveSlot) || "0");
      const deltaMeta = _movimentoAcao === "depositar" ? valor : -valor;
      localStorage.setItem(chaveSlot, Math.max(0, depAtual + deltaMeta).toFixed(2));
      window._depMetaMesAntes = depAtual; // usado logo abaixo no cálculo cross-month
      salvarDadosMeta(dados.valor, dados.mes, dados.ano, dados.categoria, dados.saldoAcumulado, dados.movimentos);
    }
    atualizarBarraReserva();
  }

  // Depósito: lê distribuição do painel dist (dataset.valor)
  // Retirada: usa _movimentoDestino (bloco escolhido no painel dest)
  let _d1Final = 0, _d2Final = 0;
  if (_movimentoAcao === 'depositar') {
    _d1Final = parseFloat((document.getElementById('popup-dist-b1') || {}).dataset.valor || '0');
    _d2Final = parseFloat((document.getElementById('popup-dist-b2') || {}).dataset.valor || '0');
  } else {
    // Enforça o limite por bloco ANTES de modificar dep_reserva
    // (o espaco já foi calculado quando _movimentoSelecionarDestino foi chamado — usa _movimentoMax)
    const valorLimitado = Math.min(valor, _movimentoMax);
    if (_movimentoDestino === 2) { _d2Final = valorLimitado; } else { _d1Final = valorLimitado; }
    valor = valorLimitado;
  }

  window._depResMesAntes  = 0;
  window._depMetaMesAntes = 0;

  fecharPopupMovimento();

  // Aplica distribuição por bloco
  if (_movimentoAcao === 'depositar') {
    _aplicarDepositoBlocos(_d1Final, _d2Final);
  } else {
    _aplicarRetiradaBlocos(_d1Final, _d2Final, valor);
  }

  salvarMes();
  recalc();
}

// Registra a fração do depósito que veio de cada bloco.
// dep_reserva/dep_meta já guardam o total — aqui só guardamos a repartição por bloco.
function _aplicarDepositoBlocos(d1, d2) {
  const chave = 'mov_previsao_blocos_' + anoAtual + '_' + indice;
  const raw = localStorage.getItem(chave);
  const atual = raw ? JSON.parse(raw) : { depB1: 0, depB2: 0, retB1: 0, retB2: 0 };

  // Re-depósito cancela retiradas anteriores do mesmo bloco:
  // se retB1>0 e depositando no B1, reduz retB1 primeiro antes de aumentar depB1.
  // Isso garante que liqTotal = totalDesconto - retB1 - retB2 seja consistente.
  if (d1 > 0) {
    const cancelaRet1 = Math.min(d1, atual.retB1 || 0);
    atual.retB1 = (atual.retB1 || 0) - cancelaRet1;
    atual.depB1 = (atual.depB1 || 0) + (d1 - cancelaRet1);
  }
  if (d2 > 0) {
    const cancelaRet2 = Math.min(d2, atual.retB2 || 0);
    atual.retB2 = (atual.retB2 || 0) - cancelaRet2;
    atual.depB2 = (atual.depB2 || 0) + (d2 - cancelaRet2);
  }

  localStorage.setItem(chave, JSON.stringify(atual));
  aplicarMovimentoPrevisao(d1 + d2);
}

// Retirada: registra em qual bloco entrou e aplica à previsão.
// retB1/retB2 são usados no recalc para forçar que o alívio do desconto
// caia no bloco correto (não se distribuir automaticamente 50/50).
function _aplicarRetiradaBloco(bloco, valor) {
  const chave = 'mov_previsao_blocos_' + anoAtual + '_' + indice;
  const raw = localStorage.getItem(chave);
  const atual = raw ? JSON.parse(raw) : { depB1: 0, depB2: 0, retB1: 0, retB2: 0 };
  if (bloco === 1) atual.retB1 = (atual.retB1 || 0) + valor;
  else             atual.retB2 = (atual.retB2 || 0) + valor;
  localStorage.setItem(chave, JSON.stringify(atual));
  aplicarMovimentoPrevisao(-valor);
}

// Versão distribuída: registra r1 no bloco 1 e r2 no bloco 2.
// total = porção que veio de depósitos DESTE mês (pode ser 0 para retiradas cross-month).
// r1/r2 são sempre registrados nos blocos para atualizar os badges.
// Mas aplicarMovimentoPrevisao só é chamado para a porção deste mês (total).
// Para saque cross-month (total=0): badge atualiza via retB1/retB2, previsão não muda.
function _aplicarRetiradaBlocos(r1, r2, total) {
  // Registra nos blocos para atualizar badges
  if (r1 > 0.004 || r2 > 0.004) {
    const chave = 'mov_previsao_blocos_' + anoAtual + '_' + indice;
    const raw = localStorage.getItem(chave);
    const atual = raw ? JSON.parse(raw) : { depB1: 0, depB2: 0, retB1: 0, retB2: 0 };
    atual.retB1 = (atual.retB1 || 0) + r1;
    atual.retB2 = (atual.retB2 || 0) + r2;
    localStorage.setItem(chave, JSON.stringify(atual));
  }
  // Sempre atualiza previsão — saque sempre libera dinheiro no mês atual
  aplicarMovimentoPrevisao(-total);
}

// Armazena o ajuste do mês atual para o cálculo da previsão de saldo.
// delta positivo = depósito (reduz previsão); delta negativo = retirada (aumenta previsão).
// A fórmula em recalc() é: previsão = salário - gastos - ajuste
function aplicarMovimentoPrevisao(delta) {
  const chave = "mov_previsao_" + anoAtual + "_" + indice;
  const atual = parseFloat(localStorage.getItem(chave) || "0");
  localStorage.setItem(chave, (atual + delta).toFixed(2));
  recalc();
}

function getMovimentoPrevisao() {
  const chave = "mov_previsao_" + anoAtual + "_" + indice;
  return parseFloat(localStorage.getItem(chave) || "0");
}

/* ── 18. BARRA DE PROGRESSO DA META ────────────────────────────────────
 *  Exibida no card de meta no painel direito.
 *  Cores da barra: cinza (< 40%) → amarelo (40-80%) → verde (> 80%) → completo (100%)
 *  atualizarBarraReserva(): recarrega dados da meta ativa (_metaIdx) e renderiza
 * ────────────────────────────────────────────────────────────────────── */
/* ── BARRA DE PROGRESSO DA META ────────────────────────────────────────
 *  Cores: cinza < 40% → amarelo 40-80% → verde > 80% → completo 100%.
 *  atualizarBarraReserva() recarrega dados da meta ativa e re-renderiza.
 * ────────────────────────────────────────────────────────────────────── */
/* ── BARRA DE PROGRESSO META ── */
function _renderizarMetaComSaldo(dados) {
  const meta  = dados ? num(dados.valor) : 0;
  const atual = dados ? num(dados.saldoAcumulado || "R$ 0,00") : 0;

  const atualEl = document.getElementById("res-prog-atual");
  if (atualEl) atualEl.textContent = brl(atual);

  const temMeta = dados && dados.valor && meta > 0;
  document.getElementById("res-vazio-state").style.display  = temMeta ? "none" : "flex";
  document.getElementById("res-ativo-state").style.display  = temMeta ? "block" : "none";

  if (!temMeta) {
    const pctEl = document.getElementById("res-prog-pct");
    if (pctEl) pctEl.textContent = "";
    return;
  }

  _renderizarPilha();

  const pctVal = Math.min((atual / meta) * 100, 100);
  const fill   = document.getElementById("res-prog-fill");
  const pctEl  = document.getElementById("res-prog-pct");
  fill.style.width = pctVal.toFixed(2) + "%";
  const cor = pctVal >= 80 ? "verde" : pctVal >= 40 ? "amarelo" : "";
  fill.className = "reserva-prog-fill" + (cor ? " " + cor : "") + (pctVal >= 100 ? " completo" : "");
  pctEl.textContent = pctVal.toFixed(2).replace(".", ",") + "%";
  pctEl.className = "reserva-prog-pct" + (pctVal >= 80 ? " verde" : pctVal >= 40 ? " amarelo" : "");

  // Anel de progresso (modo 1 entrada) — espelha o mesmo pctVal da barra
  // linear acima. Guard com "if" porque o anel só existe no DOM uma vez
  // (elemento compartilhado, movido via appendChild igual ao resto do
  // card); calcular tudo aqui garante que fica sempre sincronizado com
  // a barra, sem precisar duplicar a lógica de cálculo em outro lugar.
  const ringProgress = document.getElementById("meta-ring-progress");
  if (ringProgress) {
    const CIRCUNFERENCIA = 2 * Math.PI * 19; // r=19, mesmo raio do círculo no index.html
    const offset = CIRCUNFERENCIA - (CIRCUNFERENCIA * pctVal / 100);
    ringProgress.style.strokeDasharray = CIRCUNFERENCIA.toFixed(2);
    ringProgress.style.strokeDashoffset = offset.toFixed(2);
  }
}

function atualizarBarraReserva() {
  const dados = carregarDadosMeta();
  if (!dados) {
    _renderizarMetaComSaldo(null);
    return;
  }
  const movs = dados.movimentos || [];
  const saldo = movs.length > 0
    ? calcularSaldoAteMes(movs, anoAtual, indice)
    : num(dados.saldoAcumulado || "R$ 0,00");
  _renderizarMetaComSaldo({ ...dados, saldoAcumulado: brl(saldo) });
}

/* ── 19. MULTI-META (3 SLOTS FIXOS) ────────────────────────────────────
 *  Até 3 metas simultâneas, cada uma em um slot (0, 1, 2) do localStorage.
 *  _metasPreenchidas(): lista metas ativas + "fantasmas" (metas excluídas
 *    que ainda devem aparecer em meses anteriores à exclusão).
 *  _renderizarPilha(): renderiza o card principal (meta ativa) e os cards
 *    de fundo (s1, s2), pontinhos de navegação e botões prev/next.
 *  Clicar em um card de fundo anima o card principal vindo de baixo.
 *
 *  Chaves de "fantasma": "meta_excluida_v2_0", "_1", "_2"
 *    → mantém histórico de metas deletadas para exibição em meses passados
 * ────────────────────────────────────────────────────────────────────── */
/* ── MULTI-META (3 SLOTS FIXOS) ────────────────────────────────────────
 *  Até 3 metas simultâneas em slots 0, 1, 2 do localStorage.
 *  "Fantasmas": metas excluídas que aparecem em meses anteriores à exclusão.
 *    Chave: "meta_excluida_v2_0/1/2"
 *  _renderizarPilha(): renderiza card principal + cards de fundo (s1/s2)
 *    + pontinhos. Clicar num card de fundo anima a troca.
 * ────────────────────────────────────────────────────────────────────── */
/* ── MULTI-META (3 slots fixos) ── */

function _metaKey(idx) { return _META_KEYS[idx ?? _metaIdx]; }

function carregarDadosMeta(idx) {
  const raw = localStorage.getItem(_metaKey(idx));
  return raw ? JSON.parse(raw) : null;
}

function salvarDadosMeta(valor, mes, ano, categoria, saldoAcumulado, movimentos) {
  const atual = carregarDadosMeta();
  localStorage.setItem(_metaKey(), JSON.stringify({
    valor, mes, ano, categoria,
    saldoAcumulado: saldoAcumulado || "R$ 0,00",
    movimentos: movimentos || [],
    nome: atual ? (atual.nome || "") : "",
    criadoAno: atual ? (atual.criadoAno || "") : "",
    criadoMes: atual ? (atual.criadoMes || "") : ""
  }));
}

function excluirMeta() { excluirMetaAtiva(); }

function excluirMetaAtiva() {
  const dados = carregarDadosMeta(_metaIdx);

  // Devolve o saldo total acumulado da meta para a previsão de saldo do mês atual
  if (dados) {
    const movs = dados.movimentos || [];
    const saldoTotal = movs.length > 0
      ? calcularSaldoAteMes(movs, anoAtual, indice)
      : num(dados.saldoAcumulado || "R$ 0,00");
    if (saldoTotal > 0.004) {
      const chave = "mov_previsao_" + anoAtual + "_" + indice;
      const atual = parseFloat(localStorage.getItem(chave) || "0");
      // ajuste funciona como: previsao = salario - gastos - ajuste
      // depositar na meta somou ao ajuste; para devolver, subtraímos
      localStorage.setItem(chave, (atual - saldoTotal).toFixed(2));
    }
    // Zera rastreio dep_meta de todos os meses
    movs.forEach(m => {
      const chaveDep = "dep_meta_" + _metaIdx + "_" + (m.ano ?? anoAtual) + "_" + (m.mes ?? indice);
      localStorage.setItem(chaveDep, "0");
    });
  }

  localStorage.removeItem(_metaKey());

  const total = _contarMetas();
  if (_metaIdx > 0 && _metaIdx >= total) _metaIdx = total - 1;
  if (_metaIdx < 0) _metaIdx = 0;

  recalc();
  _renderizarPilha();
  atualizarBarraReserva();
}

function navegarMeta(delta) {
  const total = _contarMetas();
  _metaIdx = Math.max(0, Math.min(_metaIdx + delta, total - 1));
  _renderizarPilha();
  atualizarBarraReserva();
}

let _novoMetaSlot = -1; // slot reservado para nova meta — só confirmado em confirmarMeta()

function adicionarNovaMeta() {
  // Encontra o próximo slot vazio
  let slot = -1;
  for (let i = 0; i < _META_MAX; i++) {
    if (!carregarDadosMeta(i)) { slot = i; break; }
  }
  if (slot === -1) {
    exibirToastSaldo("Você já atingiu o limite de " + _META_MAX + " metas. Conclua ou exclua uma para cadastrar outra.");
    return;
  }
  // Guarda o slot sem alterar _metaIdx — só muda ao confirmar
  _novoMetaSlot = slot;
  abrirPopupMeta(slot);
}

function editarMetaAtiva() { abrirPopupMeta(); }

function _contarMetas() {
  return _META_KEYS.filter(k => localStorage.getItem(k)).length;
}

// Retorna metas que existiam até o mês/ano atual sendo visualizado
function _metaExisteNoMes(dados) {
  // Usa criadoAno/criadoMes se disponível
  if (dados.criadoAno !== undefined) {
    return dados.criadoAno < anoAtual ||
           (dados.criadoAno === anoAtual && dados.criadoMes <= indice);
  }
  // Sem data de criação: tenta usar primeiro movimento para inferir
  const movs = dados.movimentos || [];
  if (movs.length > 0) {
    const primeiro = movs.reduce((min, m) => {
      const mAno = m.ano ?? 9999;
      const mMes = m.mes ?? 99;
      return (mAno < min.ano || (mAno === min.ano && mMes < min.mes))
        ? { ano: mAno, mes: mMes } : min;
    }, { ano: 9999, mes: 99 });
    return primeiro.ano < anoAtual ||
           (primeiro.ano === anoAtual && primeiro.mes <= indice);
  }
  // Meta legada sem data e sem movimentos: não exibir em meses anteriores
  return false;
}

function _metasPreenchidas() {
  const ativas = _META_KEYS.map((k, i) => ({ idx: i, dados: carregarDadosMeta(i) }))
    .filter(m => m.dados && m.dados.valor && _metaExisteNoMes(m.dados));

  return ativas;
}

function _renderizarPilha() {
  const lista = _metasPreenchidas();
  const tem   = lista.length > 0;

  document.getElementById("res-vazio-state").style.display = tem ? "none" : "flex";
  document.getElementById("res-ativo-state").style.display = tem ? "block" : "none";

  // Oculta botão "+ Nova" quando 3 slots cheios — só afeta botão dentro do card ativo
  const btnNova = document.querySelector('#res-ativo-state [onclick="adicionarNovaMeta()"]');
  if (btnNova) btnNova.style.display = lista.length >= _META_MAX ? "none" : "";

  if (!tem) return;

  // Garante que _metaIdx aponta para um slot com dados
  if (!lista.find(m => m.idx === _metaIdx)) {
    _metaIdx = lista[0].idx;
  }

  const d   = carregarDadosMeta(_metaIdx) || lista.find(m => m.idx === _metaIdx)?.dados;
  const tot = lista.length;
  // posição visual (0-based) dentro da lista preenchida
  const pos = lista.findIndex(m => m.idx === _metaIdx);

  // Nome
  const nomeEl = document.getElementById("meta-card-nome");
  if (nomeEl) nomeEl.textContent = d.nome || ("Meta " + (_metaIdx + 1));

  // Navegação
  const nav = document.getElementById("meta-card-nav");
  if (nav) nav.style.display = tot > 1 ? "flex" : "none";
  const ctr = document.getElementById("meta-card-counter");
  if (ctr) ctr.textContent = (pos + 1) + "/" + tot;
  const bp = document.getElementById("meta-nav-prev");
  const bn = document.getElementById("meta-nav-next");
  if (bp) bp.disabled = pos === 0;
  if (bn) bn.disabled = pos === tot - 1;

  // Cards de fundo — renderiza conteúdo real da próxima/anterior meta
  const s1 = document.getElementById("meta-stack-s1");
  const s2 = document.getElementById("meta-stack-s2");

  function _renderizarCardTras(el, metaDados, metaIdxAlvo) {
    if (!el || !metaDados) return;
    const saldo = metaDados.movimentos && metaDados.movimentos.length > 0
      ? calcularSaldoAteMes(metaDados.movimentos, anoAtual, indice)
      : num(metaDados.saldoAcumulado || "R$ 0,00");
    const meta  = num(metaDados.valor || "0");
    const pct   = meta > 0 ? Math.min((saldo / meta) * 100, 100) : 0;
    const cor   = pct >= 80 ? "#1c3f91" : pct >= 40 ? "#d4a017" : "#3a6edc";
    const nome = metaDados.nome || ("Meta " + (metaIdxAlvo + 1));
    el.style.position = "relative";
    el.innerHTML = `
      <span class="stack-preview-nome">${nome}</span>`;
    el.style.display = "block";

    // Clique: anima o card principal de baixo para cima usando o card real
    el.onclick = () => {
      const cardPrincipal = document.getElementById("meta-card-principal");
      if (!cardPrincipal) return;

      const fromRect = el.getBoundingClientRect();
      const toRect   = cardPrincipal.getBoundingClientRect();

      // 1. Atualiza o card principal com os dados da meta alvo (card real, estilos corretos)
      _metaIdx = metaIdxAlvo;
      _renderizarPilha();
      atualizarBarraReserva();

      // Desativa transição da barra para não animar do zero
      const fillEl = document.getElementById("res-prog-fill");
      if (fillEl) {
        fillEl.style.transition = "none";
        fillEl.getBoundingClientRect();
      }

      // 2. Posiciona o card real na posição do card de trás via transform (sem mover do DOM)
      const dx = fromRect.left - toRect.left;
      const dy = fromRect.top  - toRect.top;

      // Bloqueia scroll da página durante a animação
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      cardPrincipal.style.transition = "none";
      cardPrincipal.style.transform  = `translate(${dx}px, ${dy}px)`;
      cardPrincipal.style.boxShadow  = "0 4px 10px rgba(28,63,145,0.10)";
      cardPrincipal.style.zIndex     = "9999";

      // Força repaint
      cardPrincipal.getBoundingClientRect();

      // 3. Anima de volta à posição original
      const dur = "0.4s cubic-bezier(0.22,1,0.36,1)";
      cardPrincipal.style.transition = `transform ${dur}, box-shadow 0.3s`;
      cardPrincipal.style.transform  = "translate(0,0)";
      cardPrincipal.style.boxShadow  = "";

      // 4. Limpa estilos após animação e restaura transição da barra
      setTimeout(() => {
        cardPrincipal.style.transition = "";
        cardPrincipal.style.transform  = "";
        cardPrincipal.style.zIndex     = "";
        if (fillEl) fillEl.style.transition = "";
        document.body.style.overflow = prevOverflow;
      }, 420);
    };
  }

  // Próxima meta na lista (circularmente)
  const idxS1 = (pos + 1) % tot;
  const idxS2 = (pos + 2) % tot;

  if (tot > 1) {
    _renderizarCardTras(s1, lista[idxS1].dados, lista[idxS1].idx);
  } else {
    if (s1) { s1.style.display = "none"; s1.onclick = null; }
  }
  if (tot > 2) {
    _renderizarCardTras(s2, lista[idxS2].dados, lista[idxS2].idx);
  } else {
    if (s2) { s2.style.display = "none"; s2.onclick = null; }
  }

  // Pontinhos
  const dots = document.getElementById("meta-nav-dots");
  if (dots) {
    dots.innerHTML = "";
    if (tot > 1) lista.forEach((m, i) => {
      const dot = document.createElement("button");
      dot.className = "meta-nav-dot" + (m.idx === _metaIdx ? " ativo" : "");
      dot.onclick = () => { _metaIdx = m.idx; _renderizarPilha(); atualizarBarraReserva(); };
      dots.appendChild(dot);
    });
  }

  // Categoria badge
  const cb = document.getElementById("res-categoria-badge");
  if (cb) {
    if (d.categoria) { cb.textContent = d.categoria; cb.style.display = "inline-block"; }
    else cb.style.display = "none";
  }

  // Meta display e prazo
  const de = document.getElementById("res-meta-display");
  if (de) de.textContent = d.valor || "—";
  const pr = document.getElementById("res-prazo-row");
  const pt = document.getElementById("res-prazo-txt");
  if (d.mes && d.ano) {
    const nm = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    if (pt) pt.textContent = "📅 Prazo: " + nm[parseInt(d.mes) - 1] + " de " + d.ano;
    if (pr) pr.style.display = "block";
  } else {
    if (pr) pr.style.display = "none";
  }
}

function atualizarDisplayMeta() { _renderizarPilha(); }

/* ── DROPDOWNS CUSTOMIZADOS DO POPUP META ── */
function inicializarDropdownsMeta() {
  [
    { wrapId: "popup-meta-mes-wrap", displayId: "popup-meta-mes-display", listId: "popup-meta-mes-list", hiddenId: "popup-meta-mes" },
    { wrapId: "popup-meta-ano-wrap", displayId: "popup-meta-ano-display", listId: "popup-meta-ano-list", hiddenId: "popup-meta-ano" }
  ].forEach(({ wrapId, displayId, listId, hiddenId }) => {
    const wrap    = document.getElementById(wrapId);
    const display = document.getElementById(displayId);
    const list    = document.getElementById(listId);
    const hidden  = document.getElementById(hiddenId);

    // Abre/fecha ao clicar no display
    display.addEventListener("click", (e) => {
      e.stopPropagation();
      // Fecha outros dropdowns do popup
      document.querySelectorAll(".popup-meta-drop-list.open").forEach(l => {
        if (l !== list) l.classList.remove("open");
      });
      list.classList.toggle("open");
    });

    // Seleciona item
    list.querySelectorAll(".popup-meta-drop-item").forEach(item => {
      item.addEventListener("click", () => {
        const val   = item.dataset.val;
        const label = item.textContent;
        hidden.value = val;
        display.textContent = label;
        display.classList.toggle("vazio", !val);
        list.querySelectorAll(".popup-meta-drop-item").forEach(i => i.classList.remove("ativo"));
        item.classList.add("ativo");
        list.classList.remove("open");
      });
    });
  });

  // Fecha ao clicar fora
  document.addEventListener("click", () => {
    document.querySelectorAll(".popup-meta-drop-list.open").forEach(l => l.classList.remove("open"));
  });
}

function sincronizarDropdownMeta(hiddenId, displayId, listId, valor) {
  const hidden  = document.getElementById(hiddenId);
  const display = document.getElementById(displayId);
  const list    = document.getElementById(listId);
  hidden.value  = valor || "";
  const item    = list ? list.querySelector(`.popup-meta-drop-item[data-val="${valor || ""}"]`) : null;
  const label   = item ? item.textContent : (hiddenId.includes("mes") ? "Mês" : "Ano");
  display.textContent = label;
  display.classList.toggle("vazio", !valor);
  list && list.querySelectorAll(".popup-meta-drop-item").forEach(i => i.classList.toggle("ativo", i.dataset.val === (valor || "")));
}

function abrirPopupMeta(slotOverride) {
  const _x_popup_meta = document.getElementById("x-popup-meta"); if (_x_popup_meta) _x_popup_meta.style.display = "flex";
  const idxParaAbrir = (slotOverride !== undefined) ? slotOverride : _metaIdx;
  const dados = carregarDadosMeta(idxParaAbrir);

  const ni = document.getElementById("popup-meta-nome");
  if (ni) ni.value = dados ? (dados.nome || "") : "";

  document.getElementById("popup-meta-valor").value = dados ? (dados.valor || "") : "";

  // Sincroniza dropdowns customizados
  sincronizarDropdownMeta("popup-meta-mes", "popup-meta-mes-display", "popup-meta-mes-list", dados ? dados.mes : "");
  sincronizarDropdownMeta("popup-meta-ano", "popup-meta-ano-display", "popup-meta-ano-list", dados ? dados.ano : "");

  // Restaura categoria selecionada
  const catAtiva = dados ? (dados.categoria || "") : "";
  document.querySelectorAll(".popup-cat-btn").forEach(btn => {
    btn.classList.toggle("ativo", btn.dataset.cat === catAtiva);
  });

  // Listeners dos chips
  document.querySelectorAll(".popup-cat-btn").forEach(btn => {
    btn.onclick = function() {
      document.querySelectorAll(".popup-cat-btn").forEach(b => b.classList.remove("ativo"));
      this.classList.add("ativo");
    };
  });

  const overlay = document.getElementById("popup-meta-overlay");
  const popup   = document.getElementById("popup-meta");
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => {
    popup.style.opacity       = "1";
    popup.style.transform     = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "auto";
  });
}

// Quando o usuário digita no campo personalizado, desmarca os chips


function fecharPopupMeta() {
  const _x_popup_meta = document.getElementById("x-popup-meta"); if (_x_popup_meta) _x_popup_meta.style.display = "none";
  const overlay = document.getElementById("popup-meta-overlay");
  const popup   = document.getElementById("popup-meta");
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.93)";
  popup.style.pointerEvents = "none";
  // Cancelou sem confirmar — descarta o slot reservado, _metaIdx não muda
  _novoMetaSlot = -1;
  setTimeout(() => {
    popup.style.display   = "none";
    overlay.style.display = "none";
  }, 220);
}

function confirmarMeta() {
  const valor = document.getElementById("popup-meta-valor").value;
  const mes   = document.getElementById("popup-meta-mes").value;
  const ano   = document.getElementById("popup-meta-ano").value;

  const catBtn = document.querySelector(".popup-cat-btn.ativo");
  const categoria = catBtn ? catBtn.dataset.cat : "";

  if (!valor || num(valor) <= 0) {
    const inp = document.getElementById("popup-meta-valor");
    inp.style.borderColor = "#e74c3c";
    setTimeout(() => inp.style.borderColor = "", 1200);
    return;
  }
  // Só agora confirma o slot novo — _metaIdx passa a apontar para ele
  if (_novoMetaSlot !== -1) {
    _metaIdx = _novoMetaSlot;
    _novoMetaSlot = -1;
  }
  const ni = document.getElementById("popup-meta-nome");
  const nome = ni ? ni.value.trim() : "";
  const dadosAtuais = carregarDadosMeta();
  salvarDadosMeta(valor, mes, ano, categoria,
    dadosAtuais ? dadosAtuais.saldoAcumulado : "R$ 0,00",
    dadosAtuais ? dadosAtuais.movimentos     : []);
  // Salva nome e data de criação no objeto
  const raw = localStorage.getItem(_metaKey());
  if (raw) {
    const obj = JSON.parse(raw);
    if (nome) obj.nome = nome;
    // Marca data de criação só quando é uma meta nova
    if (!obj.criadoAno && !obj.criadoMes) {
      obj.criadoAno = anoAtual;
      obj.criadoMes = indice;
    }
    localStorage.setItem(_metaKey(), JSON.stringify(obj));
  }
  atualizarDisplayMeta();
  atualizarBarraReserva();
  fecharPopupMeta();
}

function salvarMetaReserva() { /* compatibilidade */ }

function carregarMetaReserva() {
  _renderizarPilha();
  atualizarBarraReserva();
}

// Inicializa carregando o mês atual do LocalStorage
// Migração: garante que todas as metas legadas tenham criadoAno/criadoMes
function _migrarDatasCriacao() {
  _META_KEYS.forEach(k => {
    const raw = localStorage.getItem(k);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj.criadoAno !== undefined) return; // já tem data, ok
    // Infere pelo primeiro movimento
    const movs = obj.movimentos || [];
    if (movs.length > 0) {
      const primeiro = movs.reduce((min, m) => {
        const mAno = m.ano ?? 9999;
        const mMes = m.mes ?? 99;
        return (mAno < min.ano || (mAno === min.ano && mMes < min.mes))
          ? { ano: mAno, mes: mMes } : min;
      }, { ano: 9999, mes: 99 });
      if (primeiro.ano !== 9999) {
        obj.criadoAno = primeiro.ano;
        obj.criadoMes = primeiro.mes;
        localStorage.setItem(k, JSON.stringify(obj));
        return;
      }
    }
    // Sem movimentos: usa mês atual como data de criação
    obj.criadoAno = new Date().getFullYear();
    obj.criadoMes = new Date().getMonth();
    localStorage.setItem(k, JSON.stringify(obj));
  });
}

/* ── 20. REPLICAR MÊS INTEIRO ──────────────────────────────────────────
 *  Copia todos os lançamentos do mês atual para os próximos N meses.
 *  Se algum mês-alvo já tem dados, exibe popup perguntando:
 *    "Manter" → preenche apenas meses vazios (preserva salário dos destinos)
 *    "Sobrescrever" → substitui tudo nos meses-alvo
 * ────────────────────────────────────────────────────────────────────── */
/* ── REPLICAR MÊS INTEIRO ──────────────────────────────────────────────
 *  Copia todos os lançamentos do mês atual para N meses à frente.
 *  Se mês-alvo já tem dados: "Manter" (só preenche vazios) ou "Sobrescrever".
 * ────────────────────────────────────────────────────────────────────── */
/* ── REPLICAR MÊS INTEIRO ── */
let _replicarMesQtd = 0;
// Dados salvos para uso no popup de confirmação
let _rmDadosAtual    = null;
let _rmMesesComDados = [];
let _rmQtdTotal      = 0;

function abrirPopupReplicarMes() {
  const _x_popup_replicar_mes = document.getElementById("x-popup-replicar-mes"); if (_x_popup_replicar_mes) _x_popup_replicar_mes.style.display = "flex";
  _replicarMesQtd = 0;

  const grid = document.getElementById("parcelas-mes-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= 6; i++) {
    const b = document.createElement("button");
    b.className = "parcela-btn";
    b.textContent = i + "x";
    b.addEventListener("click", () => {
      document.querySelectorAll("#parcelas-mes-grid .parcela-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _replicarMesQtd = i;
      document.getElementById("parcela-mes-custom-input").value = "";
    });
    grid.appendChild(b);
  }

  const inp = document.getElementById("parcela-mes-custom-input");
  inp.value = "";
  inp.oninput = function() {
    const v = parseInt(this.value);
    if (v >= 1) {
      _replicarMesQtd = v;
      document.querySelectorAll("#parcelas-mes-grid .parcela-btn").forEach(x => x.classList.remove("ativo"));
    }
  };

  document.getElementById("popup-replicar-mes-overlay").classList.add("visivel");
  const popup = document.getElementById("popup-replicar-mes");
  requestAnimationFrame(() => requestAnimationFrame(() => popup.classList.add("visivel")));
}

function fecharPopupReplicarMes() {
  const _x_popup_replicar_mes = document.getElementById("x-popup-replicar-mes"); if (_x_popup_replicar_mes) _x_popup_replicar_mes.style.display = "none";
  document.getElementById("popup-replicar-mes-overlay").classList.remove("visivel");
  document.getElementById("popup-replicar-mes").classList.remove("visivel");
  _replicarMesQtd = 0;
}

// ── REPLICAR SALÁRIO ──────────────────────────────────────────
let _replicarSalEntrada = 0;
let _replicarSalQtd = 0;

function _replicarSalVerificarBloqueio() {
  // 1. Mês fechado em qualquer ponto à frente → bloqueia sempre
  for (let p = 1; ; p++) {
    const totalMes = indice + p;
    const mesAlvo  = totalMes % 12;
    const anoAlvo  = anoAtual + Math.floor(totalMes / 12);
    if (anoAlvo > ANO_MAX || (anoAlvo === ANO_MAX && mesAlvo > MES_MAX)) break;
    if (mesFechado(anoAlvo, mesAlvo)) return 'fechado';
  }
  // 2. Salário da mesma entrada já preenchido em algum mês destino (dentro da qtd selecionada)
  if (_replicarSalQtd >= 1) {
    for (let p = 1; p <= _replicarSalQtd; p++) {
      const totalMes = indice + p;
      const mesAlvo  = totalMes % 12;
      const anoAlvo  = anoAtual + Math.floor(totalMes / 12);
      if (anoAlvo > ANO_MAX || (anoAlvo === ANO_MAX && mesAlvo > MES_MAX)) break;
      const chavePlan = 'planejamento_' + anoAlvo + '_' + mesAlvo;
      const dadosDest = JSON.parse(localStorage.getItem(chavePlan) || '{}');
      if (dadosDest['sal' + _replicarSalEntrada]) return 'preenchido';
    }
  }
  return null; // sem bloqueio
}

function _replicarSalAtualizarEstado() {
  const aviso = document.getElementById('popup-replicar-sal-aviso');
  const btn   = document.getElementById('btn-replicar-sal-confirmar');
  if (!aviso || !btn) return;
  const motivo = _replicarSalVerificarBloqueio();
  if (motivo === 'fechado') {
    aviso.textContent = 'Existem meses fechados a partir deste mês. Reabra todos os meses seguintes antes de replicar o salário.';
    aviso.style.display = 'block';
    btn.classList.add('bloqueado');
  } else if (motivo === 'preenchido') {
    aviso.textContent = 'Um ou mais meses do período já têm salário preenchido. Apague manualmente em cada mês antes de replicar.';
    aviso.style.display = 'block';
    btn.classList.add('bloqueado');
  } else {
    aviso.style.display = 'none';
    btn.classList.remove('bloqueado');
  }
}

function abrirPopupReplicarSal(entrada) {
  _replicarSalEntrada = entrada;
  _replicarSalQtd = 0;

  const salVal = document.getElementById('sal' + entrada)?.value || '';
  const subtitulo = document.getElementById('popup-replicar-sal-subtitulo');
  if (subtitulo) {
    subtitulo.textContent = 'Salário' + (salVal ? ' de ' + salVal : '') + ' e entradas extras serão copiados para os próximos meses';
  }

  // Avalia bloqueio imediatamente ao abrir
  _replicarSalAtualizarEstado();

  // Gera botões de meses (1x a 6x)
  const grid = document.getElementById('parcelas-sal-grid');
  grid.innerHTML = '';
  for (let i = 1; i <= 6; i++) {
    const b = document.createElement('button');
    b.className = 'parcela-btn';
    b.textContent = i + 'x';
    b.dataset.meses = i;
    b.addEventListener('click', function() {
      document.querySelectorAll('#parcelas-sal-grid .parcela-btn').forEach(x => x.classList.remove('ativo'));
      b.classList.add('ativo');
      _replicarSalQtd = i;
      document.getElementById('parcela-sal-custom-input').value = '';
      _replicarSalAtualizarEstado();
    });
    grid.appendChild(b);
  }

  document.getElementById('parcela-sal-custom-input').value = '';
  document.getElementById('parcela-sal-custom-input').oninput = function() {
    const v = parseInt(this.value);
    if (v >= 1) {
      _replicarSalQtd = v;
      document.querySelectorAll('#parcelas-sal-grid .parcela-btn').forEach(x => x.classList.remove('ativo'));
      _replicarSalAtualizarEstado();
    }
  };

  const overlay = document.getElementById('popup-replicar-sal-overlay');
  const popup   = document.getElementById('popup-replicar-sal');
  overlay.classList.add('visivel');
  requestAnimationFrame(() => requestAnimationFrame(() => popup.classList.add('visivel')));
}

function fecharPopupReplicarSal() {
  document.getElementById('popup-replicar-sal-overlay').classList.remove('visivel');
  document.getElementById('popup-replicar-sal').classList.remove('visivel');
  _replicarSalQtd = 0;
}

function confirmarReplicarSal() {
  if (_replicarSalQtd < 1) {
    exibirToastSaldo('Selecione ou digite a quantidade de meses para replicar.');
    return;
  }
  if (_replicarSalVerificarBloqueio()) return;

  // _valorBase é a fonte de verdade do salário base (sem extras somadas)
  const salInput = document.getElementById('sal' + _replicarSalEntrada);
  const salVal   = (salInput && salInput._valorBase !== undefined && salInput._valorBase !== '')
                   ? salInput._valorBase
                   : (salInput ? salInput.value : '');

  // Extras do mês atual para esta entrada
  const extrasAtual   = _extrasCarregar();
  const extrasEntrada = extrasAtual[String(_replicarSalEntrada)] || [];
  const infoEntrada   = extrasAtual['info' + _replicarSalEntrada] === true;
  const baseEntrada   = salVal;

  let replicados = 0;

  for (let p = 1; p <= _replicarSalQtd; p++) {
    const totalMes = indice + p;
    const mesAlvo  = totalMes % 12;
    const anoAlvo  = anoAtual + Math.floor(totalMes / 12);
    if (anoAlvo > ANO_MAX || (anoAlvo === ANO_MAX && mesAlvo > MES_MAX)) break;

    // Grava sal no planejamento
    const chavePlan = 'planejamento_' + anoAlvo + '_' + mesAlvo;
    const dadosDest = JSON.parse(localStorage.getItem(chavePlan) || '{}');
    dadosDest['sal' + _replicarSalEntrada] = salVal;
    localStorage.setItem(chavePlan, JSON.stringify(dadosDest));

    // Grava extras_sal — replica estado exato do mês atual
    const chaveExtras = 'extras_sal_' + anoAlvo + '_' + mesAlvo;
    const extrasDest  = JSON.parse(localStorage.getItem(chaveExtras) || '{}');
    extrasDest['base' + _replicarSalEntrada] = baseEntrada;
    extrasDest[String(_replicarSalEntrada)]  = JSON.parse(JSON.stringify(extrasEntrada));
    extrasDest['info' + _replicarSalEntrada] = infoEntrada;
    localStorage.setItem(chaveExtras, JSON.stringify(extrasDest));

    replicados++;
  }

  fecharPopupReplicarSal();

  const feedbackEl = document.createElement('div');
  feedbackEl.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
    'background:linear-gradient(135deg,#1c3f91,#3a6edc);color:#fff;padding:12px 24px;' +
    'border-radius:10px;font-size:13px;font-weight:700;font-family:inherit;' +
    'box-shadow:0 4px 20px rgba(58,110,220,0.4);z-index:99999;white-space:nowrap;';
  feedbackEl.textContent = '✓ Salário replicado em ' + replicados + (replicados === 1 ? ' mês!' : ' meses!');
  document.body.appendChild(feedbackEl);
  setTimeout(() => feedbackEl.remove(), 3000);
}

function confirmarReplicarMes() {
  if (_replicarMesQtd < 1) {
    exibirToastSaldo("Selecione ou digite a quantidade de meses para replicar.");
    return;
  }

  salvarMes();

  const chaveAtual = "planejamento_" + anoAtual + "_" + indice;
  _rmDadosAtual = JSON.parse(localStorage.getItem(chaveAtual) || "{}");

  _rmMesesComDados = [];
  for (let p = 1; p <= _replicarMesQtd; p++) {
    const totalMes = indice + p;
    const mesAlvo  = totalMes % 12;
    const anoAlvo  = anoAtual + Math.floor(totalMes / 12);
    if (anoAlvo > ANO_MAX || (anoAlvo === ANO_MAX && mesAlvo > MES_MAX)) break;
    const chave = "planejamento_" + anoAlvo + "_" + mesAlvo;
    const raw   = localStorage.getItem(chave);
    if (raw) {
      const d = JSON.parse(raw);
      const temDados = Object.keys(d).some(k => k.endsWith("_val") && d[k]);
      if (temDados) _rmMesesComDados.push({ p, mesIdx: mesAlvo, anoIdx: anoAlvo, nomeMes: meses[mesAlvo] + "/" + anoAlvo });
    }
  }

  // Meses dentro do prazo que estão vazios
  const totalMesesValidos = (() => {
    let count = 0;
    for (let p = 1; p <= _replicarMesQtd; p++) {
      const totalMes = indice + p;
      const anoAlvo = anoAtual + Math.floor(totalMes / 12);
      const mesAlvo = totalMes % 12;
      if (anoAlvo > ANO_MAX || (anoAlvo === ANO_MAX && mesAlvo > MES_MAX)) break;
      count++;
    }
    return count;
  })();
  const temMesesVazios = _rmMesesComDados.length < totalMesesValidos;
  _rmQtdTotal = _replicarMesQtd;

  fecharPopupReplicarMes();

  if (_rmMesesComDados.length > 0) {
    const lista = _rmMesesComDados.map(m => "<li><strong>" + m.nomeMes + "</strong></li>").join("");
    document.getElementById("sobrescrever-mes-lista").innerHTML = lista;
    // Mostra/esconde botão "Manter existentes" conforme se há meses vazios
    const btnManter = document.getElementById("btn-manter-mes");
    if (btnManter) btnManter.style.display = temMesesVazios ? "" : "none";
    const overlay = document.getElementById("popup-sobrescrever-mes-overlay");
    const pop     = document.getElementById("popup-sobrescrever-mes");
    overlay.style.display = "block";
    pop.style.display     = "block";
    pop.style.opacity     = "0";
    pop.style.transform   = "translate(-50%,-50%) scale(0.92)";
    pop.style.pointerEvents = "none";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pop.style.opacity       = "1";
      pop.style.transform     = "translate(-50%,-50%) scale(1)";
      pop.style.pointerEvents = "auto";
    }));
  } else {
    _fazerReplicarMes("sobrescrever");
  }
}

function fecharPopupSobrescreverMes() {
  const _x_popup_sobrescrever_mes = document.getElementById("x-popup-sobrescrever-mes"); if (_x_popup_sobrescrever_mes) _x_popup_sobrescrever_mes.style.display = "none";
  const overlay = document.getElementById("popup-sobrescrever-mes-overlay");
  const pop     = document.getElementById("popup-sobrescrever-mes");
  pop.style.opacity       = "0";
  pop.style.transform     = "translate(-50%,-50%) scale(0.92)";
  pop.style.pointerEvents = "none";
  setTimeout(() => { pop.style.display = "none"; overlay.style.display = "none"; }, 220);
}

function _fazerReplicarMes(modo) {
  fecharPopupSobrescreverMes();
  const dadosAtual       = _rmDadosAtual || {};
  const mesesComDadosSet = new Set(_rmMesesComDados.map(m => m.p));
  let replicados = 0;

  for (let p = 1; p <= _rmQtdTotal; p++) {
    const totalMes = indice + p;
    const mesAlvo  = totalMes % 12;
    const anoAlvo  = anoAtual + Math.floor(totalMes / 12);
    if (anoAlvo > ANO_MAX || (anoAlvo === ANO_MAX && mesAlvo > MES_MAX)) break;

    const chave = "planejamento_" + anoAlvo + "_" + mesAlvo;

    if (mesesComDadosSet.has(p) && modo === "manter") continue;

    // Copia os gastos mas preserva sempre o salário do mês destino
    let novosDados = Object.assign({}, dadosAtual);
    const rawDest = localStorage.getItem(chave);
    const dest    = rawDest ? JSON.parse(rawDest) : {};
    // Salário nunca é sobrescrito pelo replicar mês — usa o que já está no destino
    if (dest.sal1) novosDados.sal1 = dest.sal1; else delete novosDados.sal1;
    if (dest.sal2) novosDados.sal2 = dest.sal2; else delete novosDados.sal2;

    localStorage.setItem(chave, JSON.stringify(novosDados));

    replicados++;
  }

  const feedbackEl = document.createElement("div");
  feedbackEl.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);" +
    "background:linear-gradient(135deg,#1c3f91,#3a6edc);color:#fff;padding:12px 24px;" +
    "border-radius:10px;font-size:13px;font-weight:700;font-family:inherit;" +
    "box-shadow:0 4px 20px rgba(58,110,220,0.4);z-index:99999;white-space:nowrap;";
  feedbackEl.textContent = "✓ Mês replicado em " + replicados + (replicados === 1 ? " mês!" : " meses!");
  document.body.appendChild(feedbackEl);
  setTimeout(() => feedbackEl.remove(), 3000);
}

// Chamados diretamente pelos botões do popup HTML
function replicarMesSobrescrever() { _fazerReplicarMes("sobrescrever"); }
function replicarMesManter()       { _fazerReplicarMes("manter"); }

/* ── INICIALIZAÇÃO ──────────────────────────────────────────────────────
 *  Executado quando o HTML termina de carregar.
 *  Ordem de inicialização:
 *    1. _migrarDatasCriacao()   → garante que metas legadas tenham criadoAno/Mes
 *    2. adicionarBotoesLimpar() → injeta botões em cada .linha do HTML
 *    3. inicializarCoresBancos()→ substitui <select>s por dropdowns coloridos
 *    4. inicializarDropdownsMeta() → configura dropdowns do popup de meta
 *    5. carregarMes()           → restaura dados do mês atual do localStorage
 *    6. carregarMetaReserva()   → renderiza pilha de metas
 *    7. atualizarBarraReserva() → preenche barra de progresso
 *    8. atualizarDisplayReserva()→ atualiza saldo da reserva
 *    9. _inicializarIconePrevisao()→ configura tooltip do ícone de % do card
 * ────────────────────────────────────────────────────────────────────── */
/* ── INICIALIZAÇÃO ──────────────────────────────────────────────────────
 *  Ordem: migrarDatas → botoesLimpar → coresBancos → dropdownsMeta
 *         → carregarMes → metaReserva → barraReserva → displayReserva
 *         → iconePrevisao
 * ────────────────────────────────────────────────────────────────────── */
window.addEventListener("DOMContentLoaded", function() {
  // Limpa chaves legadas de "meta excluída" que não são mais usadas
  [0, 1, 2].forEach(i => localStorage.removeItem("meta_excluida_v2_" + i));
  _migrarDatasCriacao();
  adicionarBotoesLimpar();
  inicializarCoresBancos();
  inicializarDropdownsMeta();
  _aplicarPerfilRenda();
  carregarMes();
  carregarMetaReserva();
  atualizarBarraReserva();
  atualizarDisplayReserva();
  _inicializarIconePrevisao();
});

/* ── Aplica o layout do perfil de renda escolhido no 1º acesso ──
 *  'unica': esconde a coluna 2 via CSS (classe no body) e trava
 *  sal2 em 0 — o motor de cálculo (recalc, fechamento, replicação,
 *  anual) continua somando sal1+sal2 normalmente, só que a segunda
 *  entrada nunca recebe valor. Nenhuma função de cálculo é alterada. ── */
function _aplicarPerfilRenda() {
  // Atalho de debug: ?perfil=unica ou ?perfil=duas na URL força o valor,
  // sem precisar passar pelo cadastro/login. Útil só para testes.
  const urlParams = new URLSearchParams(window.location.search);
  const debugPerfil = urlParams.get('perfil');
  if (debugPerfil === 'unica' || debugPerfil === 'duas') {
    localStorage.setItem('planova_perfil_renda', debugPerfil);
  }

  const perfil = localStorage.getItem('planova_perfil_renda');
  if (perfil !== 'unica') return;

  document.body.classList.add('perfil-unico');

  const sal2 = document.getElementById('sal2');
  if (sal2) {
    sal2.value = '';
    sal2.readOnly = true;
    sal2.tabIndex = -1;
  }
  // Impede qualquer tentativa de digitar/colar em sal2, mesmo via DevTools acidental
  if (sal2) {
    sal2.addEventListener('input', function() { sal2.value = ''; recalc(); });
  }

  // Move os cards de previsão/reserva/metas do painel-direita (que fica
  // oculto) para #pu-grid-extra, a célula responsável pela 2ª linha do
  // layout único. appendChild move o nó real — preserva ids, onclick,
  // listeners e qualquer estado já presente no elemento.
  // Saldo+Gastos e Reserva+Metas ficam em wrappers PRÓPRIOS (em vez de
  // direto no grid) pra que a altura de um lado não dependa do outro —
  // antes, ao esticar Saldo/Gastos pra acompanhar a altura de
  // Reserva+Metas, qualquer mudança no card de metas inflava os cards
  // de previsão também, ficando desproporcional.
  // REDESENHO (jun/2026): os 4 itens (Saldo, Gastos, Reserva, Metas) viram
  // colunas de UM painel só (divididas por linhas finas), em vez de 2
  // sub-painéis empilhados — por isso entram direto em #pu-grid-extra,
  // sem os wrappers #pu-cards-principais/#pu-sidebar de antes.
  const destino = document.getElementById('pu-grid-extra');
  if (destino && !destino.dataset.montado) {
    const saldo = document.querySelector('.previsao-card--saldo');
    const gastos = document.querySelector('.previsao-card:not(.previsao-card--saldo)');
    const reserva = document.querySelector('.reserva-card');
    const metas = document.querySelector('.metas-reserva-card-outer');
    if (saldo) destino.appendChild(saldo);
    if (gastos) destino.appendChild(gastos);
    if (reserva) destino.appendChild(reserva);
    if (metas) destino.appendChild(metas);
    destino.dataset.montado = '1';
  }

  // Insere separadores verticais entre Residência/Cartões/Outros — sem
  // eles os 3 blocos ficam soltos no layout em flex. Reaproveita a
  // mesma classe .separador usada entre colunas (mesmo visual, só sem
  // a margem inline que aqui é dispensada — o espaçamento já vem do
  // gap do .blocos-area). Guard contra duplicar em re-execuções.
  const blocosArea = document.querySelector('#coluna1-wrapper .blocos-area');
  if (blocosArea && !blocosArea.querySelector('.separador')) {
    const blocos = Array.from(blocosArea.querySelectorAll(':scope > .bloco-wrap'));
    for (let i = blocos.length - 1; i > 0; i--) {
      const sep = document.createElement('div');
      sep.className = 'separador';
      blocosArea.insertBefore(sep, blocos[i]);
    }
  }

  // Padroniza Cartões e Outros em 5 linhas, igual à Residência — só no
  // perfil único. Não toca em bloco2-* (coluna 2 do perfil padrão), que
  // continua como está. Clona a última linha do próprio bloco (preserva
  // as opções do select daquele bloco) e zera os valores. Os 3 botões
  // injetados por _inicializarLinha (subcategoria/replicar/limpar) são
  // removidos antes do clone porque foram ligados via addEventListener
  // na linha original — não sobrevivem ao cloneNode — e reconectados
  // via _inicializarLinha() só na linha nova, sem reprocessar (e
  // duplicar o listener de checkbox em) as linhas já existentes.
  ['bloco1-cart', 'bloco1-emp'].forEach(blocoId => {
    const bloco = document.querySelector('#' + blocoId + ' .bloco');
    if (!bloco) return;
    const linhas = bloco.querySelectorAll(':scope > .linha');
    if (linhas.length === 0 || linhas.length >= 5) return;
    const nova = linhas[linhas.length - 1].cloneNode(true);
    nova.querySelectorAll('.btn-subcategoria-linha, .btn-replicar-linha, .btn-limpar-linha').forEach(b => b.remove());
    // O dropdown customizado de banco (.select-banco-wrap) também veio
    // no clone, mas só visualmente — os listeners de clique foram
    // ligados via addEventListener no select ORIGINAL e não sobrevivem
    // ao cloneNode (mesmo motivo dos 3 botões acima). Sem isso, a caixa
    // "Selecione" da linha nova aparece normal mas não abre ao clicar.
    // Remove o clone quebrado e reconstrói do zero com criarSelectBanco().
    nova.querySelectorAll('.select-banco-wrap').forEach(w => w.remove());
    const sel = nova.querySelector('select');
    const val = nova.querySelector('.val-input');
    const chk = nova.querySelector('input[type=checkbox]');
    if (sel) sel.value = '';
    if (val) val.value = '';
    if (chk) chk.checked = false;
    nova.classList.remove('paga');
    delete nova._subcategoria;
    bloco.appendChild(nova);
    _inicializarLinha(nova);
    if (sel) { delete sel._customDisplay; criarSelectBanco(sel); }
  });

  // ── Alinhamento robusto do número entre "R$ X,XX" e "X,XX%" ──
  // "R$ " só existe à esquerda do valor e "%" só existe à direita do
  // %, então o NÚMERO em si sai do centro da própria caixa de texto
  // em direções opostas (puxado pelo afixo que cada um tem). Centrar
  // a caixa toda deixa os dois números desalinhados entre si; deslocar
  // com pixels fixos (transform) depende da largura real do afixo na
  // fonte carregada — que varia entre ambientes — e quebra fácil.
  // Em vez disso, separa o afixo do número em spans e usa CSS Grid
  // (1fr | número | 1fr) em ambas as linhas: a coluna do meio fica
  // sempre centralizada de verdade, sem depender de medir nada.
  ['p-previsao', 'p-econpct', 'p-total', 'p-gastospct'].forEach(id => {
    const el = document.getElementById(id);
    if (el) _envolverAfixoNumero(el);
  });
}

// Observa um elemento de valor/% e, sempre que o texto mudar (qualquer
// recalc, em qualquer parte do código — não precisa alterar onde o
// valor é escrito), separa o prefixo "R$ " ou o sufixo "%" do número
// em spans próprios. Reconcilia contra o DOM atual (não um cache do
// último texto visto) — se outro código sobrescrever .textContent com
// o MESMO valor em texto puro (desfazendo o wrap sem mudar a string),
// ainda assim refaz o wrap. Desconecta o observer durante a própria
// escrita pra não disparar loop nele mesmo.
function _envolverAfixoNumero(el) {
  if (el._afixoObserver) return; // já observando
  const obs = new MutationObserver(aplicar);
  function aplicar() {
    const texto = el.textContent;
    let prefixo = "", numero = texto, sufixo = "";
    if (texto.startsWith("R$ ")) { prefixo = "R$"; numero = texto.slice(3); }
    else if (texto.endsWith("%")) { numero = texto.slice(0, -1); sufixo = "%"; }
    else return; // texto sem afixo conhecido (ex: "—") — não reformata

    // Já está no formato esperado? Compara contra o DOM de verdade,
    // não contra um valor cacheado — evita refazer sem necessidade,
    // mas sem confiar que "mesmo texto" implique "já formatado".
    const numEl = el.querySelector(":scope > .afixo-numero");
    const temPrefixo = !!el.querySelector(":scope > .afixo-prefixo");
    const temSufixo = !!el.querySelector(":scope > .afixo-sufixo");
    if (numEl && numEl.textContent === numero && temPrefixo === !!prefixo && temSufixo === !!sufixo) {
      return;
    }

    obs.disconnect();
    el.innerHTML = "";
    if (prefixo) {
      const s = document.createElement("span");
      s.className = "afixo-fixo afixo-prefixo";
      s.textContent = prefixo;
      el.appendChild(s);
    }
    const num = document.createElement("span");
    num.className = "afixo-numero";
    num.textContent = numero;
    el.appendChild(num);
    if (sufixo) {
      const s = document.createElement("span");
      s.className = "afixo-fixo afixo-sufixo";
      s.textContent = sufixo;
      el.appendChild(s);
    }
    obs.observe(el, { childList: true, characterData: true, subtree: true });
  }
  aplicar();
  obs.observe(el, { childList: true, characterData: true, subtree: true });
  el._afixoObserver = obs;
}


function _inicializarIconePrevisao() {
  const icone = document.getElementById("previsao-pct-info-icon");
  const tooltip = document.getElementById("previsao-pct-tooltip");
  if (!icone || !tooltip) return;

  // Insere o SVG do ícone sem apagar o tooltip já existente
  if (!icone.querySelector("svg")) {
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("width", "11"); svgEl.setAttribute("height", "11");
    svgEl.setAttribute("viewBox", "0 0 24 24"); svgEl.setAttribute("fill", "none");
    svgEl.setAttribute("stroke", "#8a9cc8"); svgEl.setAttribute("stroke-width", "2.2");
    svgEl.setAttribute("stroke-linecap", "round"); svgEl.setAttribute("stroke-linejoin", "round");
    svgEl.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8" stroke-width="3"/><line x1="12" y1="12" x2="12" y2="16"/>';
    icone.insertBefore(svgEl, icone.firstChild);
  }

  // Hover com delay — JS fallback para :has() em browsers antigos
  let _timerIn, _timerOut;
  icone.addEventListener("mouseenter", () => {
    clearTimeout(_timerOut);
    _timerIn = setTimeout(() => {
      tooltip.style.opacity = "1";
      tooltip.style.visibility = "visible";
    }, 0);
  });
  icone.addEventListener("mouseleave", () => {
    clearTimeout(_timerIn);
    _timerOut = setTimeout(() => {
      tooltip.style.opacity = "0";
      tooltip.style.visibility = "hidden";
    }, 100);
  });
  tooltip.addEventListener("mouseenter", () => clearTimeout(_timerOut));
  tooltip.addEventListener("mouseleave", () => {
    tooltip.style.opacity = "0";
    tooltip.style.visibility = "hidden";
  });
}

// Flag para suprimir salvarMes durante importação (evita sobrescrever dados importados)
let _importacaoEmAndamento = false;

// Salva ao fechar ou recarregar a página
window.addEventListener("beforeunload", function() {
  if (_importacaoEmAndamento) return; // não sobrescreve dados recém-importados
  salvarMes();
});

// Salva ao trocar de aba (minimizar, etc.)
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "hidden" && !_importacaoEmAndamento) {
    salvarMes();
  }
});
/* ── 23. CONFIGURAÇÕES (ENGRENAGEM) ────────────────────────────────────
 *  Popup que abre via botão de engrenagem no FAB inferior-esquerdo.
 *  Permite configurar:
 *    • Alerta de previsão: notifica quando saldo previsto cai abaixo de X%
 *    • Coloração da previsão: destaca o card em vermelho quando em alerta
 *  Estados salvos em localStorage: "cfg_alerta_economia", "cfg_alerta_pct",
 *  "cfg_alerta_cor".
 *  Configurações do Diário (popup separado):
 *    • Toggle: usa previsão de saldo como limite mensal OU valor manual
 * ────────────────────────────────────────────────────────────────────── */
/* ── CONFIGURAÇÕES (ENGRENAGEM) ────────────────────────────────────────
 *  Alerta de previsão: notifica quando saldo previsto < X% da receita.
 *  Coloração: destaca o card em vermelho no alerta.
 *  Estados: "cfg_alerta_economia", "cfg_alerta_pct", "cfg_alerta_cor".
 *  Config Diário: toggle que determina se limite mensal vem da previsão
 *    de saldo ou de valor manual (salvo em "diario_limite_mensal_ativo").
 * ────────────────────────────────────────────────────────────────────── */
/* ── CONFIGURAÇÕES (engrenagem) ── */
let _configAberto = false;
let _alertaPrevisaoAtivo = JSON.parse(localStorage.getItem("cfg_alerta_economia") || "false"); // chave localStorage mantida para não perder dados salvos
let _alertaPrevisaoPct   = parseFloat(localStorage.getItem("cfg_alerta_pct") || "20");
let _alertaCorAtivo      = JSON.parse(localStorage.getItem("cfg_alerta_cor") || "true");
let _alertaPrevisaoJaDisparado = false;

function abrirConfig() {
  if (_configAberto) { fecharConfig(); return; }
  _configAberto = true;
  _sincronizarToggle();
  const overlay = document.getElementById("popup-config-overlay");
  const popup   = document.getElementById("popup-config");
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.style.opacity   = "1";
    popup.style.transform = "translateY(0) scale(1)";
    popup.style.pointerEvents = "auto";
  }));
}

/* ══════════════════════════════════════════════
   DIÁRIO — NOVA ARQUITETURA v3
   Períodos de gasto independentes do mês.
   ══════════════════════════════════════════════ */

const _DIARIO_CHAVE_PERIODOS  = 'diario_periodos_v3';
const _DIARIO_CHAVE_SAIDAS    = 'diario_saidas_v3';
const _DIARIO_CHAVE_ALOCACAO  = 'diario_alocacao_v1'; // { mesAno: { '1': valor, '2': valor } }
const _DIARIO_MAX_HISTORICO  = 6;
let   _diarioPeriodoAtual    = 0;
let   _diarioSlotEditando    = null;

function _diarioCarregarPeriodos() {
  const raw = localStorage.getItem(_DIARIO_CHAVE_PERIODOS);
  return raw ? JSON.parse(raw) : [];
}

function _diarioSalvarPeriodos(arr) {
  localStorage.setItem(_DIARIO_CHAVE_PERIODOS, JSON.stringify(arr));
  // Recalcula alocações agrupadas por (ano, mes, entrada) para o recalc/badge
  _diarioRecalcularAlocacoes(arr);
}

function _diarioRecalcularAlocacoes(arr) {
  // Reconstrói o mapa de alocações do zero a partir dos períodos salvos
  const raw = localStorage.getItem(_DIARIO_CHAVE_ALOCACAO);
  const all = raw ? JSON.parse(raw) : {};
  // Limpa apenas as chaves que existiam (não apaga dados de outros meses não afetados)
  // Reconstrói completo para garantir consistência
  const novoAll = {};
  (arr || []).forEach(function(p) {
    const key = p.anoRef + '_' + p.mesRef;
    if (!novoAll[key]) novoAll[key] = { '1': 0, '2': 0 };
    const entKey = String(p.entrada);
    if (entKey === '1' || entKey === '2') {
      novoAll[key][entKey] = (novoAll[key][entKey] || 0) + (p.valor || 0);
    }
  });
  localStorage.setItem(_DIARIO_CHAVE_ALOCACAO, JSON.stringify(novoAll));
}

function _diarioChaveSaida(periodoId, ano, mes, dia) {
  const mm = String(mes + 1).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return _DIARIO_CHAVE_SAIDAS + '_' + periodoId + '_' + ano + '-' + mm + '-' + dd;
}

function _diarioSalvarSaida(periodoId, ano, mes, dia, valor) {
  localStorage.setItem(_diarioChaveSaida(periodoId, ano, mes, dia), valor || '');
}

function _diarioCarregarSaida(periodoId, ano, mes, dia) {
  return localStorage.getItem(_diarioChaveSaida(periodoId, ano, mes, dia)) || '';
}

function _diarioParseData(ano, mes, dia) {
  return new Date(ano, mes, dia);
}

function _diarioDiffDias(d1, d2) {
  return Math.round((d2 - d1) / 86400000);
}

function _diarioPeriodoEncerrado(p) {
  const hoje = new Date();
  const fim  = _diarioParseData(p.anoFim, p.mesFim, p.diaFim);
  return hoje > new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1) - 1;
}

function _diarioPeriodoTemSaidas(p) {
  const ini = _diarioParseData(p.anoIni, p.mesIni, p.diaIni);
  const fim = _diarioParseData(p.anoFim, p.mesFim, p.diaFim);
  const cur = new Date(ini);
  while (cur <= fim) {
    const v = _diarioCarregarSaida(p.id, cur.getFullYear(), cur.getMonth(), cur.getDate());
    if (v && num(v) > 0) return true;
    cur.setDate(cur.getDate() + 1);
  }
  return false;
}

function _diarioPeriodasSeSobrepoe(p1, p2) {
  const ini1 = _diarioParseData(p1.anoIni, p1.mesIni, p1.diaIni);
  const fim1 = _diarioParseData(p1.anoFim, p1.mesFim, p1.diaFim);
  const ini2 = _diarioParseData(p2.anoIni, p2.mesIni, p2.diaIni);
  const fim2 = _diarioParseData(p2.anoFim, p2.mesFim, p2.diaFim);
  return ini1 <= fim2 && ini2 <= fim1;
}

function _diarioLimparHistoricoAntigo() {
  const periodos = _diarioCarregarPeriodos();
  const agora = new Date();
  const limite = new Date(agora.getFullYear(), agora.getMonth() - _DIARIO_MAX_HISTORICO, 1);
  const novos = periodos.filter(function(p) {
    return _diarioParseData(p.anoFim, p.mesFim, p.diaFim) >= limite;
  });
  if (novos.length !== periodos.length) _diarioSalvarPeriodos(novos);
}

function _diarioGetGrupos() {
  const periodos = _diarioCarregarPeriodos();
  periodos.sort(function(a, b) {
    return _diarioParseData(b.anoIni, b.mesIni, b.diaIni) - _diarioParseData(a.anoIni, a.mesIni, a.diaIni);
  });
  const map = {};
  periodos.forEach(function(p) {
    const g = p.slotGroup !== undefined ? p.slotGroup : p.id;
    if (!map[g]) map[g] = [];
    map[g].push(p);
  });
  return Object.values(map).sort(function(a, b) {
    return _diarioParseData(b[0].anoIni, b[0].mesIni, b[0].diaIni) - _diarioParseData(a[0].anoIni, a[0].mesIni, a[0].diaIni);
  });
}

function renderizarDiario() {
  _diarioLimparHistoricoAntigo();
  const grupos = _diarioGetGrupos();
  const vazio  = document.getElementById('diario-vazio-state');
  const ativo  = document.getElementById('diario-ativo-state');
  const dataEl = document.getElementById('diario-data-atual');
  const mesLabel = document.getElementById('diario-mes-label');

  if (dataEl) {
    const hoje = new Date();
    const dd = String(hoje.getDate()).padStart(2,'0');
    const mm = String(hoje.getMonth()+1).padStart(2,'0');
    dataEl.textContent = 'Hoje: ' + dd + '/' + mm + '/' + hoje.getFullYear();
  }

  if (mesLabel) {
    mesLabel.textContent = meses[indice] + ' ' + anoAtual;
  }
  _atualizarDiarioTituloMes();

  // Mostrar apenas períodos com mesRef/anoRef explícito para este mês
  const gruposMes = grupos.filter(function(g) {
    return g.some(function(p) {
      return p.mesRef === indice && p.anoRef === anoAtual;
    });
  });

  if (gruposMes.length === 0) {
    if (vazio) vazio.style.display = 'flex';
    if (ativo) ativo.style.display = 'none';
    return;
  }

  if (vazio) vazio.style.display = 'none';
  if (ativo) ativo.style.display = 'block';

  if (_diarioPeriodoAtual >= gruposMes.length) _diarioPeriodoAtual = 0;

  const grupo = gruposMes[_diarioPeriodoAtual];
  const btnPrev = document.getElementById('diario-nav-prev');
  const btnNext = document.getElementById('diario-nav-next');
  if (btnPrev) btnPrev.style.opacity = '1';
  if (btnNext) btnNext.style.opacity = '1';

  // Ordena os períodos do grupo por data de início (mais antiga = esquerda, mais recente = direita)
  const grupoOrdenado = grupo.slice().sort(function(a, b) {
    return _diarioParseData(a.anoIni, a.mesIni, a.diaIni) - _diarioParseData(b.anoIni, b.mesIni, b.diaIni);
  });
  const slot0 = grupoOrdenado[0] || null;
  const slot1 = grupoOrdenado[1] || null;
  const unico = grupoOrdenado.length === 1;

  _diarioRenderizarSlot(0, slot0, unico);
  _diarioRenderizarSlot(1, slot1, unico);

  const btnAdd = document.getElementById('diario-add-segundo-btn');
  // Slot livre para cadastro: usa o slot salvo oposto ao existente
  const slotLivre = slot0 && slot1 ? -1 : (slot0 ? (slot0.slot === 0 ? 1 : 0) : 0);
  if (btnAdd) {
    btnAdd.style.display = (unico && _diarioPeriodoAtual === 0) ? 'block' : 'none';
    btnAdd.onclick = function() { abrirPopupDiarioCadastro(slotLivre >= 0 ? slotLivre : 1, true); };
  }
}

function _diarioRenderizarSlot(slotIdx, periodo, unico) {
  const wrap = document.getElementById('diario-wrap-' + slotIdx);
  if (!wrap) return;

  if (!periodo) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';
  const encerrado = _diarioPeriodoEncerrado(periodo);
  wrap.style.opacity = encerrado ? '0.72' : '1';
  wrap.style.filter  = encerrado ? 'grayscale(0.3)' : '';
  if (unico) wrap.classList.add('unico'); else wrap.classList.remove('unico');

  const colunas = document.getElementById('diario-colunas');
  if (colunas) colunas.style.justifyContent = unico ? 'center' : 'flex-start';

  const _NM  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const _NMC = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const labelEl = document.getElementById('diario-periodo-label-' + slotIdx);
  if (labelEl) {
    const dIni = String(periodo.diaIni).padStart(2,'0');
    const dFim = String(periodo.diaFim).padStart(2,'0');
    const mesmoMes = periodo.mesIni === periodo.mesFim && periodo.anoIni === periodo.anoFim;
    if (mesmoMes) {
      labelEl.textContent = dIni + ' ' + _NMC[periodo.mesIni] + ' → ' + dFim + ' ' + _NMC[periodo.mesFim] + ' ' + periodo.anoIni;
    } else {
      labelEl.textContent = dIni + ' ' + _NMC[periodo.mesIni] + ' → ' + dFim + ' ' + _NMC[periodo.mesFim] + ' ' + periodo.anoFim;
    }
  }
  const valorEl = document.getElementById('diario-periodo-valor-' + slotIdx);
  if (valorEl) valorEl.textContent = brl(periodo.valor);

  // Setar onclick dos botões com o id real do período (evita bug de slot)
  const btnEdit = wrap.querySelector('.diario-periodo-btn-edit');
  const btnDel  = wrap.querySelector('.diario-periodo-btn-del');
  if (btnEdit) btnEdit.onclick = function() { confirmarExcluirPeriodoDiarioById(periodo.id, true); };
  if (btnDel)  btnDel.onclick  = function() { confirmarExcluirPeriodoDiarioById(periodo.id, false); };

  const encEl    = document.getElementById('diario-encerrado-' + slotIdx);
  const sobrouEl = document.getElementById('diario-sobrou-' + slotIdx);
  if (encEl) encEl.style.display = encerrado ? 'flex' : 'none';

  const ini = _diarioParseData(periodo.anoIni, periodo.mesIni, periodo.diaIni);
  const fim = _diarioParseData(periodo.anoFim, periodo.mesFim, periodo.diaFim);
  const totalDias = _diarioDiffDias(ini, fim) + 1;
  const limiteDiario = totalDias > 0 ? periodo.valor / totalDias : 0;

  const tbody = document.getElementById('diario-tbody-' + slotIdx);
  tbody.innerHTML = '';

  let dispAcum  = 0;
  let totalSaida = 0;
  const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const cur = new Date(ini);

  while (cur <= fim) {
    const ano = cur.getFullYear(), mes = cur.getMonth(), dia = cur.getDate();
    const saidaStr = _diarioCarregarSaida(periodo.id, ano, mes, dia);
    const saidaVal = saidaStr ? num(saidaStr) : 0;
    dispAcum  += limiteDiario - saidaVal;
    totalSaida += saidaVal;

    const tr = document.createElement('tr');
    const hoje = new Date();
    if (ano === hoje.getFullYear() && mes === hoje.getMonth() && dia === hoje.getDate()) {
      tr.classList.add('diario-row-hoje');
    }
    const tdData = document.createElement('td');
    tdData.textContent = String(dia).padStart(2,'0') + '/' + String(mes+1).padStart(2,'0') + '/' + ano;
    tr.appendChild(tdData);
    const tdDia = document.createElement('td');
    tdDia.textContent = diasSemana[cur.getDay()];
    tr.appendChild(tdDia);
    const tdDisp = document.createElement('td');
    tdDisp.className = 'diario-td-disponivel' + (dispAcum < 0 ? ' negativo' : '');
    tdDisp.textContent = brl(dispAcum);
    if (dispAcum >= 0 && periodo.valor > 0) {
      const ratio = Math.min(dispAcum / periodo.valor, 1);
      const lightness = Math.round(72 - ratio * 36); // 72% (claro) → 36% (escuro)
      tdDisp.style.color = 'hsl(120,' + Math.round(40 + ratio * 30) + '%,' + lightness + '%)';
    }
    tr.appendChild(tdDisp);
    const tdSaida = document.createElement('td');

    if (!encerrado) {
      const cel = document.createElement('div');
      cel.className = 'diario-saida-cel';

      const input = document.createElement('input');
      input.type = 'text'; input.className = 'diario-saida-input';
      input.placeholder = 'R$ 0,00'; input.autocomplete = 'off';
      if (saidaStr) input.value = saidaStr;
      input.dataset.ano = ano; input.dataset.mes = mes; input.dataset.dia = dia;
      input.dataset.pid = periodo.id;
      input.addEventListener('input', function() { fmtInput(this); });
      input.addEventListener('blur', function() {
        fmt(this);
        _diarioSalvarSaida(this.dataset.pid, parseInt(this.dataset.ano), parseInt(this.dataset.mes), parseInt(this.dataset.dia), this.value);
        renderizarDiario();
      });
      input.addEventListener('keydown', function(e) { if (e.key === 'Enter') this.blur(); });

      const btnLimpar = document.createElement('button');
      btnLimpar.className = 'diario-limpar-saida';
      btnLimpar.textContent = '×';
      btnLimpar.title = 'Limpar saída';
      (function(pid, a, m, d){ btnLimpar.addEventListener('click', function() { _diarioSalvarSaida(pid, a, m, d, ''); renderizarDiario(); }); })(periodo.id, ano, mes, dia);

      cel.appendChild(input);
      cel.appendChild(btnLimpar);
      tdSaida.appendChild(cel);
    } else {
      const span = document.createElement('span');
      span.textContent = saidaStr || 'R$ 0,00';
      span.style.cssText = 'font-size:12px;color:#8a9cc8;';
      tdSaida.appendChild(span);
    }
    tr.appendChild(tdSaida);
    tbody.appendChild(tr);
    cur.setDate(cur.getDate() + 1);
  }

  const totalDispEl = document.getElementById('diario-total-disp-' + slotIdx);
  totalDispEl.textContent = brl(dispAcum);
  totalDispEl.style.color = dispAcum < 0 ? '#ff7f7f' : '#6effa0';
  document.getElementById('diario-total-saida-' + slotIdx).textContent = brl(totalSaida);

  if (encEl && sobrouEl && encerrado) {
    const sobrado = Math.max(0, periodo.valor - totalSaida);
    sobrouEl.textContent = sobrado > 0.004 ? 'Sobrou: ' + brl(sobrado) : '';
    // Botão devolver: aparece só se houver sobrado e ainda não foi devolvido
    const btnDevolver = document.getElementById('diario-devolver-' + slotIdx);
    if (btnDevolver) {
      const jaDevolveu = periodo._devolveu || false;
      btnDevolver.style.display = (sobrado > 0.004 && !jaDevolveu) ? 'inline-flex' : 'none';
      btnDevolver.dataset.periodoId = periodo.id;
      btnDevolver.dataset.sobrado   = sobrado.toFixed(2);
    }
  }
}

function devolverSobradoDiario(slotIdx) {
  const btn = document.getElementById('diario-devolver-' + slotIdx);
  if (!btn) return;
  const periodoId = btn.dataset.periodoId;
  const sobrado   = parseFloat(btn.dataset.sobrado || '0');
  if (!periodoId || sobrado <= 0.004) return;

  // Busca o período para saber qual entrada e o valor original alocado
  const periodos = _diarioCarregarPeriodos();
  const idx = periodos.findIndex(function(p) { return p.id === periodoId; });
  if (idx < 0) return;
  const periodo = periodos[idx];

  // Marca o período como devolvido e reduz o valor alocado para o que foi realmente gasto
  // (valor original - sobrado = gasto real). Isso faz _alocE1/_alocE2 no recalc
  // refletir apenas o que foi de fato consumido, corrigindo badge e subtotal automaticamente.
  const valorGasto = Math.max(0, (periodo.valor || 0) - sobrado);
  periodos[idx]._devolveu  = true;
  periodos[idx].valor      = valorGasto; // alocação passa a ser só o gasto real
  _diarioSalvarPeriodos(periodos); // recalcula _alocE1/_alocE2 internamente

  btn.style.display = 'none';
  const sobrouEl = document.getElementById('diario-sobrou-' + slotIdx);
  if (sobrouEl) sobrouEl.textContent = 'Devolvido: ' + brl(sobrado);

  recalc();
}

function diarioNavegar(dir) {
  _diarioPeriodoAtual = 0;
  clearTimeout(window._diarioNavTimeout);
  window._diarioNavTimeout = setTimeout(function() {
    changeMonth(dir);
  }, 80);
}

// ── INTEGRAÇÃO ENTRADA MENSAL → DIÁRIO ──────────────────────────────────────

let _diarioEntradaSelecionada = 0; // 0 = nenhuma, 1 ou 2

function _diarioGetAlocacoesMes(ano, mes) {
  const raw = localStorage.getItem(_DIARIO_CHAVE_ALOCACAO);
  const all = raw ? JSON.parse(raw) : {};
  return all[ano + '_' + mes] || { '1': 0, '2': 0 };
}

function _diarioSalvarAlocacaoMes(ano, mes, e1, e2) {
  const raw = localStorage.getItem(_DIARIO_CHAVE_ALOCACAO);
  const all = raw ? JSON.parse(raw) : {};
  all[ano + '_' + mes] = { '1': e1, '2': e2 };
  localStorage.setItem(_DIARIO_CHAVE_ALOCACAO, JSON.stringify(all));
}

function _diarioLivreEntrada(entradaNum, excluirPeriodoId) {
  const sal1 = num(document.getElementById('sal1').value);
  const sal2 = num(document.getElementById('sal2').value);
  const sal = entradaNum === 1 ? sal1 : sal2;
  const sub1 = (function(){ let t=0; document.getElementById('coluna1-wrapper') && document.getElementById('coluna1-wrapper').querySelectorAll('.val-input').forEach(function(i){ t+=num(i.value); }); return t; })();
  const sub2 = (function(){ let t=0; document.getElementById('coluna2-wrapper') && document.getElementById('coluna2-wrapper').querySelectorAll('.val-input').forEach(function(i){ t+=num(i.value); }); return t; })();
  const sub = entradaNum === 1 ? sub1 : sub2;

  // Total de desconto (reserva + metas) — líquido real
  const depRes = parseFloat(localStorage.getItem('dep_reserva_' + anoAtual + '_' + indice) || '0');
  let depMeta = 0;
  _META_KEYS.forEach(function(_, si) {
    depMeta += parseFloat(localStorage.getItem('dep_meta_' + si + '_' + anoAtual + '_' + indice) || '0');
  });
  const totalDesconto = depRes + depMeta;

  // Lê distribuição por bloco — idêntico ao recalc
  const blocosRaw = localStorage.getItem('mov_previsao_blocos_' + anoAtual + '_' + indice);
  const blocos    = blocosRaw ? JSON.parse(blocosRaw) : {};
  const depB1 = parseFloat(blocos.depB1 || 0);
  const depB2 = parseFloat(blocos.depB2 || 0);
  const retB1 = parseFloat(blocos.retB1 || 0);
  const retB2 = parseFloat(blocos.retB2 || 0);
  const liqB1 = depB1 - retB1;
  const liqB2 = depB2 - retB2;
  const temBlocos = (depB1 + depB2 + retB1 + retB2) > 0.004;

  const livreE1bruto = sal1 - sub1;
  const livreE2bruto = sal2 - sub2;

  let descontoE1, descontoE2;
  if (temBlocos) {
    if (liqB1 >= 0 && liqB2 >= 0) {
      descontoE1 = liqB1;
      descontoE2 = liqB2;
      const restoDesconto = Math.max(0, totalDesconto - (liqB1 + liqB2));
      if (restoDesconto > 0.004) {
        const l1rest = Math.max(0, livreE1bruto - descontoE1);
        const l2rest = Math.max(0, livreE2bruto - descontoE2);
        descontoE1 += Math.min(restoDesconto, l1rest);
        descontoE2 += Math.min(restoDesconto - Math.min(restoDesconto, l1rest), l2rest);
      }
    } else {
      descontoE1 = liqB1;
      descontoE2 = liqB2;
      const restoDesconto = Math.max(0, totalDesconto - Math.max(0, liqB1) - Math.max(0, liqB2));
      if (restoDesconto > 0.004) {
        const l1rest = Math.max(0, livreE1bruto - Math.max(0, descontoE1));
        const l2rest = Math.max(0, livreE2bruto - Math.max(0, descontoE2));
        descontoE1 += Math.min(restoDesconto, l1rest);
        descontoE2 += Math.min(restoDesconto - Math.min(restoDesconto, l1rest), l2rest);
      }
    }
  } else {
    descontoE1 = Math.min(totalDesconto, Math.max(0, livreE1bruto));
    descontoE2 = Math.min(totalDesconto - descontoE1, Math.max(0, livreE2bruto));
  }
  const desconto = entradaNum === 1 ? descontoE1 : descontoE2;

  // Alocações já usadas por períodos desta entrada neste mês (exceto o que está sendo editado)
  const periodos = _diarioCarregarPeriodos();
  let alocUsada = 0;
  periodos.forEach(function(p) {
    if (p.mesRef === indice && p.anoRef === anoAtual && p.entrada === entradaNum && p.id !== excluirPeriodoId) {
      alocUsada += p.valor;
    }
  });

  return sal - sub - desconto - alocUsada;
}

let _diarioValorMax = Infinity; // máximo permitido no input de valor do período

function _diarioEntradaJaUsada(entradaNum) {
  // Retorna o período existente neste mês para essa entrada, exceto o que está sendo editado
  const tituloEl = document.getElementById('popup-diario-titulo');
  const editId = tituloEl ? tituloEl.dataset.editId : null;
  const periodos = _diarioCarregarPeriodos();
  return periodos.find(function(p) {
    return p.mesRef === indice && p.anoRef === anoAtual && p.entrada === entradaNum && p.id !== editId;
  }) || null;
}

function _diarioSelecionarEntrada(num) {
  const jaUsado = _diarioEntradaJaUsada(num);
  if (jaUsado) {
    // Não seleciona — mantém nenhuma seleção ativa e mostra mensagem de bloqueio
    _diarioEntradaSelecionada = 0;
    document.getElementById('popup-diario-entrada-1').classList.remove('ativo');
    document.getElementById('popup-diario-entrada-2').classList.remove('ativo');
    _diarioValorMax = 0;
    const infoEl = document.getElementById('popup-diario-entrada-info');
    if (infoEl) {
      infoEl.textContent = 'Esta entrada já possui um período neste mês. Feche e edite o período existente.';
      infoEl.style.color = '#c0392b';
    }
    return;
  }
  _diarioEntradaSelecionada = num;
  document.getElementById('popup-diario-entrada-1').classList.toggle('ativo', num === 1);
  document.getElementById('popup-diario-entrada-2').classList.toggle('ativo', num === 2);
  _diarioAtualizarInfoEntrada();
}

function _diarioAtualizarInfoEntrada() {
  const infoEl = document.getElementById('popup-diario-entrada-info');
  if (!infoEl) return;
  const tituloEl = document.getElementById('popup-diario-titulo');
  const editId = tituloEl ? tituloEl.dataset.editId : null;
  const sal1 = num(document.getElementById('sal1').value);
  const sal2 = num(document.getElementById('sal2').value);
  if (sal1 === 0 && sal2 === 0) {
    infoEl.textContent = 'Nenhum salário informado na página mensal.';
    infoEl.style.color = '#c0392b';
    return;
  }
  if (_diarioEntradaSelecionada === 0) {
    infoEl.textContent = 'Selecione uma entrada para ver o saldo disponível.';
    infoEl.style.color = '#8a9cc8';
    return;
  }
  const salEntrada = _diarioEntradaSelecionada === 1 ? sal1 : sal2;
  if (salEntrada === 0) {
    infoEl.textContent = 'Esta entrada não tem salário informado.';
    infoEl.style.color = '#c0392b';
    return;
  }
  const livre = _diarioLivreEntrada(_diarioEntradaSelecionada, editId || null);
  _diarioValorMax = livre > 0 ? livre : 0;
  // Clamp imediato: se já há valor digitado que excede o novo máximo, ajusta
  const valInp = document.getElementById('popup-diario-valor');
  if (valInp && _diarioValorMax < Infinity) {
    const digited = num(valInp.value);
    if (digited > _diarioValorMax) valInp.value = _diarioValorMax > 0 ? brl(_diarioValorMax) : '';
  }
  if (livre <= 0) {
    infoEl.textContent = 'Sem saldo disponível nesta entrada para este mês.';
    infoEl.style.color = '#c0392b';
  } else {
    infoEl.textContent = 'Disponível: ' + brl(livre);
    infoEl.style.color = document.body.classList.contains('dark') ? '#5ee87a' : '#2e7d32';
  }
}

function fmtDiarioValor(input) {
  fmtInput(input);
  if (_diarioValorMax < Infinity && _diarioValorMax >= 0) {
    const v = num(input.value);
    if (v > _diarioValorMax) {
      input.value = _diarioValorMax > 0 ? brl(_diarioValorMax) : '';
      try { const len = input.value.length; input.setSelectionRange(len, len); } catch(e) {}
    }
  }
}

function _diarioPopupInicializar() {
  if (window._diarioPopupJaInicializado) return;
  window._diarioPopupJaInicializado = true;
  const _dvInp = document.getElementById('popup-diario-valor');
  if (_dvInp) {
    _dvInp.addEventListener('paste', function() {
      setTimeout(function() { fmtDiarioValor(_dvInp); }, 0);
    });
  }
}

// ── ESTADO DO CALENDÁRIO CUSTOMIZADO ──
var _dcal = {
  el:       null,   // elemento DOM do calendário
  campo:    null,   // 'ini' ou 'fim'
  ano:      0,
  mes:      0,      // 0-based
  valIni:   '',     // ISO string do campo ini
  valFim:   '',     // ISO string do campo fim
  minDate:  '',     // ISO string mínima permitida para o campo atual
  maxDate:  '',     // ISO string máxima permitida para o campo atual
};

function _dcalPad(n) { return String(n).padStart(2,'0'); }
function _dcalIso(ano, mes, dia) { return ano + '-' + _dcalPad(mes+1) + '-' + _dcalPad(dia); }
function _dcalParse(iso) {
  if (!iso) return null;
  const p = iso.split('-');
  return p.length === 3 ? { ano: +p[0], mes: +p[1]-1, dia: +p[2] } : null;
}
function _dcalFormataBR(iso) {
  const p = _dcalParse(iso);
  return p ? _dcalPad(p.dia) + '/' + _dcalPad(p.mes+1) + '/' + p.ano : null;
}

function _diarioSincronizarDisplay(fieldId) {
  const val  = fieldId === 'popup-diario-date-ini' ? _dcal.valIni : _dcal.valFim;
  const disp = document.getElementById(fieldId + '-display');
  if (!disp) return;
  const fmt = _dcalFormataBR(val);
  if (fmt) { disp.textContent = fmt; disp.classList.remove('vazio'); }
  else      { disp.textContent = 'Selecionar'; disp.classList.add('vazio'); }
}

function _diarioFormatarDataDisplay(iso) { return _dcalFormataBR(iso); }

function _diarioDateGetParts(fieldId) {
  const val = fieldId === 'popup-diario-date-ini' ? _dcal.valIni : _dcal.valFim;
  return _dcalParse(val);
}

function _diarioDateSet(fieldId, ano, mes, dia) {
  const iso = _dcalIso(ano, mes, dia);
  if (fieldId === 'popup-diario-date-ini') _dcal.valIni = iso;
  else _dcal.valFim = iso;
  _diarioSincronizarDisplay(fieldId);
}

function _diarioDateReset(fieldId) {
  if (fieldId === 'popup-diario-date-ini') _dcal.valIni = '';
  else _dcal.valFim = '';
  _diarioSincronizarDisplay(fieldId);
}

// Calcula limites (minDate/maxDate) para cada campo
function _diarioAplicarConstraintsDatas() {
  const anoIniBase = anoAtual + Math.floor(indice / 12);
  const mesIniBase = indice % 12;
  const mesFimBase = (indice + 1) % 12;
  const anoFimBase = anoAtual + Math.floor((indice + 1) / 12);
  const ultimoDiaMesFim = new Date(anoFimBase, mesFimBase + 1, 0).getDate();

  _dcal.minIni = _dcalIso(anoIniBase, mesIniBase, 1);
  _dcal.maxIni = _dcalIso(anoFimBase, mesFimBase, ultimoDiaMesFim);

  // Pré-preenche início se vazio
  if (!_dcal.valIni) {
    const hoje = new Date();
    const hojeStr = _dcalIso(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    _dcal.valIni = (hojeStr >= _dcal.minIni && hojeStr <= _dcal.maxIni) ? hojeStr : _dcal.minIni;
    _diarioSincronizarDisplay('popup-diario-date-ini');
  }

  _diarioAtualizarConstraintsFim();
}

function _diarioAtualizarConstraintsFim() {
  const mesFimBase = (indice + 1) % 12;
  const anoFimBase = anoAtual + Math.floor((indice + 1) / 12);
  const ultimoDiaMesFim = new Date(anoFimBase, mesFimBase + 1, 0).getDate();
  const maxAbsoluto = _dcalIso(anoFimBase, mesFimBase, ultimoDiaMesFim);
  const anoIniBase  = anoAtual + Math.floor(indice / 12);
  const mesIniBase  = indice % 12;

  if (_dcal.valIni) {
    const pi = _dcalParse(_dcal.valIni);
    const dataIni  = new Date(pi.ano, pi.mes, pi.dia);
    const dataMax  = new Date(dataIni.getTime() + 31 * 24 * 60 * 60 * 1000);
    const dataLim  = new Date(anoFimBase, mesFimBase + 1, 0);
    const dataFimMax = dataMax < dataLim ? dataMax : dataLim;
    _dcal.minFim = _dcal.valIni;
    _dcal.maxFim = _dcalIso(dataFimMax.getFullYear(), dataFimMax.getMonth(), dataFimMax.getDate());
    if (_dcal.valFim && (_dcal.valFim < _dcal.minFim || _dcal.valFim > _dcal.maxFim)) {
      _dcal.valFim = '';
      _diarioSincronizarDisplay('popup-diario-date-fim');
    }
  } else {
    _dcal.minFim = _dcalIso(anoIniBase, mesIniBase, 1);
    _dcal.maxFim = maxAbsoluto;
  }
}

// Abre o calendário customizado para 'ini' ou 'fim'
function _diarioAbrirPicker(campo) {
  _dcal.campo = campo;

  // Determina min/max para este campo
  const minDate = campo === 'ini' ? _dcal.minIni : _dcal.minFim;
  const maxDate = campo === 'ini' ? _dcal.maxIni : _dcal.maxFim;
  _dcal.minDate = minDate || '';
  _dcal.maxDate = maxDate || '';

  // Mes de visualização: parte do valor atual ou do min
  const valAtual = campo === 'ini' ? _dcal.valIni : _dcal.valFim;
  const ref = _dcalParse(valAtual) || _dcalParse(minDate);
  _dcal.ano = ref ? ref.ano : new Date().getFullYear();
  _dcal.mes = ref ? ref.mes : new Date().getMonth();

  // Marca wrap como aberto
  document.querySelectorAll('.diario-date-wrap.aberto').forEach(function(w){ w.classList.remove('aberto'); });
  const wrapId = campo === 'ini' ? 'diario-date-wrap-ini' : 'diario-date-wrap-fim';
  const wrap = document.getElementById(wrapId);
  if (wrap) wrap.classList.add('aberto');

  // Cria ou reutiliza o elemento
  if (!_dcal.el) {
    _dcal.el = document.createElement('div');
    _dcal.el.className = 'dcal';
    document.body.appendChild(_dcal.el);
    // Fecha ao clicar fora
    document.addEventListener('mousedown', function(e) {
      if (_dcal.el && !_dcal.el.contains(e.target)) {
        const w2 = document.getElementById('diario-date-wrap-ini');
        const w3 = document.getElementById('diario-date-wrap-fim');
        if (w2 && w2.contains(e.target)) return;
        if (w3 && w3.contains(e.target)) return;
        _dcalFechar();
      }
    });
  }

  _dcalRenderizar();

  // Posiciona abaixo do wrap
  requestAnimationFrame(function() {
    if (!wrap || !_dcal.el) return;
    const r    = wrap.getBoundingClientRect();
    const zoom = window._getCssZoom ? _getCssZoom() : 1;
    const calW = 240;
    const top  = r.bottom / zoom + 6;
    let   left = r.left   / zoom;
    if (left + calW > window.innerWidth / zoom - 8) left = window.innerWidth / zoom - calW - 8;
    _dcal.el.style.top  = top  + 'px';
    _dcal.el.style.left = left + 'px';
    _dcal.el.classList.add('visivel');
  });
}

function _dcalFechar() {
  if (!_dcal.el) return;
  _dcal.el.classList.remove('visivel');
  document.querySelectorAll('.diario-date-wrap.aberto').forEach(function(w){ w.classList.remove('aberto'); });
}

function _dcalRenderizar() {
  if (!_dcal.el) return;
  const nomesMes = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const hoje = new Date();
  const hojeIso = _dcalIso(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const valSel  = _dcal.campo === 'ini' ? _dcal.valIni : _dcal.valFim;

  // Dias da semana: D S T Q Q S S
  const dows = ['D','S','T','Q','Q','S','S'];

  // Dia 1 do mês sendo exibido
  const primeiroDia = new Date(_dcal.ano, _dcal.mes, 1);
  const totalDias   = new Date(_dcal.ano, _dcal.mes + 1, 0).getDate();
  const inicioGrid  = primeiroDia.getDay(); // 0=Dom

  // Verificar se pode navegar
  const minP = _dcalParse(_dcal.minDate);
  const maxP = _dcalParse(_dcal.maxDate);
  const podePrev = minP ? (_dcal.ano > minP.ano || (_dcal.ano === minP.ano && _dcal.mes > minP.mes)) : true;
  const podeProx = maxP ? (_dcal.ano < maxP.ano || (_dcal.ano === maxP.ano && _dcal.mes < maxP.mes)) : true;

  let html = '<div class="dcal-header">'
    + '<span class="dcal-mes-label">' + nomesMes[_dcal.mes] + ' de ' + _dcal.ano + '</span>'
    + '<div class="dcal-nav">'
    + '<button onclick="_dcalNavMes(-1)"' + (podePrev ? '' : ' disabled') + '>'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>'
    + '</button>'
    + '<button onclick="_dcalNavMes(1)"' + (podeProx ? '' : ' disabled') + '>'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>'
    + '</button>'
    + '</div></div>'
    + '<div class="dcal-grid">';

  // Cabeçalho dias da semana
  dows.forEach(function(d) { html += '<div class="dcal-dow">' + d + '</div>'; });

  // Células vazias do início
  for (var i = 0; i < inicioGrid; i++) {
    html += '<div class="dcal-day outro-mes"></div>';
  }

  // Dias do mês
  for (var d = 1; d <= totalDias; d++) {
    const iso = _dcalIso(_dcal.ano, _dcal.mes, d);
    const desab = (_dcal.minDate && iso < _dcal.minDate) || (_dcal.maxDate && iso > _dcal.maxDate);
    const sel   = iso === valSel;
    const ehHoje = iso === hojeIso;
    let cls = 'dcal-day';
    if (desab) cls += ' desabilitado';
    else if (sel) cls += ' selecionado';
    else if (ehHoje) cls += ' hoje';
    const onclick = desab ? '' : ' onclick="_dcalSelecionarDia(\'' + iso + '\')"';
    html += '<div class="' + cls + '"' + onclick + '>' + d + '</div>';
  }

  html += '</div>';
  _dcal.el.innerHTML = html;
}

function _dcalNavMes(delta) {
  _dcal.mes += delta;
  if (_dcal.mes < 0)  { _dcal.mes = 11; _dcal.ano--; }
  if (_dcal.mes > 11) { _dcal.mes = 0;  _dcal.ano++; }
  _dcalRenderizar();
}

function _dcalSelecionarDia(iso) {
  if (_dcal.campo === 'ini') {
    _dcal.valIni = iso;
    _diarioSincronizarDisplay('popup-diario-date-ini');
    _diarioAtualizarConstraintsFim();
    _diarioSincronizarDisplay('popup-diario-date-fim');
  } else {
    _dcal.valFim = iso;
    _diarioSincronizarDisplay('popup-diario-date-fim');
  }
  _dcalFechar();
}

let _diarioSegundoSlot = false; // true apenas quando cadastrando o segundo slot de um grupo existente

function _abrirPopupDiarioTour() {
  // Abre o popup silenciosamente para o tour — sem validações de salário
  _diarioValorMax = Infinity;
  _diarioSlotEditando = 0;
  _diarioSegundoSlot = false;
  window._diarioPopupJaInicializado = false;
  _diarioPopupInicializar();
  _diarioDateReset('popup-diario-date-ini');
  _diarioDateReset('popup-diario-date-fim');
  _diarioAplicarConstraintsDatas();
  document.getElementById('popup-diario-valor').value = '';
  document.getElementById('popup-diario-erro').style.display = 'none';
  document.getElementById('popup-diario-titulo').textContent = 'Cadastrar período';
  delete document.getElementById('popup-diario-titulo').dataset.editId;
  _diarioEntradaSelecionada = 0;
  document.getElementById('popup-diario-entrada-1').classList.remove('ativo');
  document.getElementById('popup-diario-entrada-2').classList.remove('ativo');
  // Limpa a mensagem de info sem chamar _diarioAtualizarInfoEntrada
  const infoEl = document.getElementById('popup-diario-entrada-info');
  if (infoEl) { infoEl.textContent = ''; infoEl.style.color = ''; infoEl.style.display = 'none'; infoEl.style.height = ''; infoEl.style.margin = ''; }
  _abrirPopupDiario();
}

function abrirPopupDiarioCadastro(slot, segundoSlot) {
  _diarioValorMax = Infinity;
  _diarioSlotEditando = slot;
  _diarioSegundoSlot = !!segundoSlot;
  window._diarioPopupJaInicializado = false;
  _diarioPopupInicializar();
  _diarioDateReset('popup-diario-date-ini');
  _diarioDateReset('popup-diario-date-fim');
  _diarioAplicarConstraintsDatas();
  document.getElementById('popup-diario-valor').value = '';
  document.getElementById('popup-diario-erro').style.display = 'none';
  document.getElementById('popup-diario-titulo').textContent = 'Cadastrar período';
  delete document.getElementById('popup-diario-titulo').dataset.editId;
  _diarioEntradaSelecionada = 0;
  document.getElementById('popup-diario-entrada-1').classList.remove('ativo');
  document.getElementById('popup-diario-entrada-2').classList.remove('ativo');
  // Limpa estilos inline que o tour possa ter deixado no infoEl
  const _infoElCad = document.getElementById('popup-diario-entrada-info');
  if (_infoElCad) { _infoElCad.style.display = ''; _infoElCad.style.height = ''; _infoElCad.style.margin = ''; }
  _diarioAtualizarInfoEntrada();
  _abrirPopupDiario();
}

function abrirPopupDiarioEditarById(periodoId) {
  const periodo = _diarioCarregarPeriodos().find(function(p){ return p.id === periodoId; });
  if (!periodo) return;
  _diarioSlotEditando = periodo.slot;
  window._diarioPopupJaInicializado = false;
  _diarioPopupInicializar();
  _diarioDateSet('popup-diario-date-ini', periodo.anoIni, periodo.mesIni, periodo.diaIni);
  _diarioDateSet('popup-diario-date-fim', periodo.anoFim, periodo.mesFim, periodo.diaFim);
  _diarioAplicarConstraintsDatas();
  document.getElementById('popup-diario-valor').value = brl(periodo.valor);
  document.getElementById('popup-diario-erro').style.display = 'none';
  document.getElementById('popup-diario-titulo').textContent = 'Editar período';
  document.getElementById('popup-diario-titulo').dataset.editId = periodo.id;
  _diarioEntradaSelecionada = periodo.entrada || 0;
  document.getElementById('popup-diario-entrada-1').classList.toggle('ativo', _diarioEntradaSelecionada === 1);
  document.getElementById('popup-diario-entrada-2').classList.toggle('ativo', _diarioEntradaSelecionada === 2);
  // Limpa estilos inline que o tour possa ter deixado no infoEl
  const _infoElEd = document.getElementById('popup-diario-entrada-info');
  if (_infoElEd) { _infoElEd.style.display = ''; _infoElEd.style.height = ''; _infoElEd.style.margin = ''; }
  _diarioAtualizarInfoEntrada();
  _abrirPopupDiario();
}

function abrirPopupDiarioEditar(slot) {
  const grupos  = _diarioGetGrupos();
  const gruposMes = grupos.filter(function(g) {
    return g.some(function(p) { return p.mesRef === indice && p.anoRef === anoAtual; });
  });
  const grupo = gruposMes[_diarioPeriodoAtual];
  if (!grupo) return;
  const periodo = grupo.find(function(p){ return p.slot === slot; }) || null;
  if (!periodo) return;
  _diarioSlotEditando = slot;
  window._diarioPopupJaInicializado = false;
  _diarioPopupInicializar();
  _diarioDateSet('popup-diario-date-ini', periodo.anoIni, periodo.mesIni, periodo.diaIni);
  _diarioDateSet('popup-diario-date-fim', periodo.anoFim, periodo.mesFim, periodo.diaFim);
  _diarioAplicarConstraintsDatas();
  document.getElementById('popup-diario-valor').value = brl(periodo.valor);
  document.getElementById('popup-diario-erro').style.display = 'none';
  document.getElementById('popup-diario-titulo').textContent = 'Editar período';
  document.getElementById('popup-diario-titulo').dataset.editId = periodo.id;
  _diarioEntradaSelecionada = periodo.entrada || 0;
  document.getElementById('popup-diario-entrada-1').classList.toggle('ativo', _diarioEntradaSelecionada === 1);
  document.getElementById('popup-diario-entrada-2').classList.toggle('ativo', _diarioEntradaSelecionada === 2);
  _diarioAtualizarInfoEntrada();
  _abrirPopupDiario();
}

function _abrirPopupDiario() {
  const overlay = document.getElementById('popup-diario-overlay');
  const popup   = document.getElementById('popup-diario');
  overlay.style.display = 'block';
  popup.style.display   = 'block';
  requestAnimationFrame(function() {
    popup.style.opacity = '1';
    popup.style.transform = 'translate(-50%,-50%) scale(1)';
    popup.style.pointerEvents = 'all';
  });
}

function fecharPopupDiario() {
  _dcalFechar();
  const overlay = document.getElementById('popup-diario-overlay');
  const popup   = document.getElementById('popup-diario');
  popup.style.opacity = '0';
  popup.style.transform = 'translate(-50%,-50%) scale(0.94)';
  popup.style.pointerEvents = 'none';
  setTimeout(function() { popup.style.display = 'none'; overlay.style.display = 'none'; }, 200);
}

function salvarPopupDiario() {
  const erroEl  = document.getElementById('popup-diario-erro');
  erroEl.style.display = 'none';
  const valor   = num(document.getElementById('popup-diario-valor').value);

  function erro(msg) { erroEl.textContent = msg; erroEl.style.display = 'block'; }

  const partsIni = _diarioDateGetParts('popup-diario-date-ini');
  const partsFim = _diarioDateGetParts('popup-diario-date-fim');

  if (!partsIni || !partsFim || valor <= 0) { erro('Preencha todos os campos corretamente.'); return; }

  const diaIni = partsIni.dia;
  const mesIni = partsIni.mes;
  const anoIni = partsIni.ano;
  const diaFim = partsFim.dia;
  const mesFim = partsFim.mes;
  const anoFim = partsFim.ano;

  const iniDate = _diarioParseData(anoIni, mesIni, diaIni);
  const fimDate = _diarioParseData(anoFim, mesFim, diaFim);

  const periodos = _diarioCarregarPeriodos();
  const tituloEl = document.getElementById('popup-diario-titulo');
  const editId   = tituloEl.dataset.editId;
  const isEdit   = !!editId;

  if (_diarioEntradaSelecionada === 0) { erro('Selecione a entrada vinculada a este período.'); return; }
  // Verifica se já existe período neste mês com essa entrada (exceto ao editar)
  const _entradaOcupada = _diarioEntradaJaUsada(_diarioEntradaSelecionada);
  if (_entradaOcupada) { erro('Esta entrada já possui um período neste mês. Edite o período existente.'); return; }
  // Valida se há saldo disponível na entrada selecionada
  const _livreEntrada = _diarioLivreEntrada(_diarioEntradaSelecionada, isEdit ? editId : null);
  if (_livreEntrada < valor - 0.004) {
    erro('Valor excede o saldo disponível da entrada selecionada (' + brl(Math.max(0, _livreEntrada)) + ' disponível).');
    return;
  }
  if (fimDate < iniDate) { erro('A data final deve ser igual ou maior do que a data inicial.'); return; }
  if (_diarioDiffDias(iniDate, fimDate) > 31) { erro('O período não pode ultrapassar 31 dias.'); return; }

  const grupos = _diarioGetGrupos();
  const gruposMesCad = grupos.filter(function(g) {
    return g.some(function(p) { return p.mesRef === indice && p.anoRef === anoAtual; });
  });
  const grupoAtual = gruposMesCad[_diarioPeriodoAtual] || null;
  // Pega qualquer período do grupo para usar o slotGroup — sem fallback por índice
  const periodoDoGrupo = grupoAtual ? grupoAtual[0] : null;
  // Agrupa com o período existente APENAS quando for explicitamente o "segundo slot" do grupo.
  // Novos períodos independentes (incluindo períodos encerrados cadastrados individualmente)
  // recebem sempre um slotGroup próprio.
  const groupId = (_diarioSegundoSlot && periodoDoGrupo)
    ? (periodoDoGrupo.slotGroup || periodoDoGrupo.id)
    : (isEdit
        ? ((periodos.find(function(p){ return String(p.id) === String(editId); }) || {}).slotGroup || editId)
        : String(Date.now()));

  const novoPeriodo = {
    id: isEdit ? editId : String(Date.now()),
    slot: _diarioSlotEditando,
    slotGroup: groupId,
    mesRef: indice,
    anoRef: anoAtual,
    diaIni: diaIni, mesIni: mesIni, anoIni: anoIni,
    diaFim: diaFim, mesFim: mesFim, anoFim: anoFim,
    valor: valor,
    entrada: _diarioEntradaSelecionada
  };

  const outros = periodos.filter(function(p){ return String(p.id) !== String(editId); });
  for (var i = 0; i < outros.length; i++) {
    if (_diarioPeriodasSeSobrepoe(novoPeriodo, outros[i])) {
      erro('Este período se sobrepõe a um período já cadastrado.'); return;
    }
  }

  if (isEdit && !window._diarioAvisoEditOk && _diarioPeriodoTemSaidas(periodos.find(function(p){ return String(p.id) === String(editId); }) || novoPeriodo)) {
    window._diarioAvisoEditOk = true;
    erro('Este período já tem gastos lançados. O saldo será recalculado. Clique em Salvar novamente para confirmar.');
    return;
  }
  window._diarioAvisoEditOk = false;

  if (isEdit) {
    const idx = periodos.findIndex(function(p){ return String(p.id) === String(editId); });
    if (idx >= 0) periodos[idx] = novoPeriodo; else periodos.push(novoPeriodo);
  } else {
    periodos.push(novoPeriodo);
  }

  _diarioSalvarPeriodos(periodos);
  _diarioPeriodoAtual = 0;
  fecharPopupDiario();
  renderizarDiario();
  recalc(false, false); // atualiza badges de saldo livre
}

let _diarioExcluirPeriodoId = null;

function confirmarExcluirPeriodoDiarioById(periodoId, isEdit) {
  if (isEdit) { abrirPopupDiarioEditarById(periodoId); return; }
  const periodo = _diarioCarregarPeriodos().find(function(p){ return p.id === periodoId; });
  if (!periodo) return;
  _diarioExcluirPeriodoId = periodo.id;
  const temSaidas = _diarioPeriodoTemSaidas(periodo);
  const msgEl = document.getElementById('popup-diario-excluir-msg');
  if (msgEl) msgEl.textContent = temSaidas ? 'Este período já tem gastos lançados. Todos os registros serão perdidos permanentemente.' : 'O período será excluído permanentemente.';
  const btnConf = document.getElementById('popup-diario-excluir-confirmar');
  if (btnConf) btnConf.onclick = _diarioExecutarExcluir;
  const overlay = document.getElementById('popup-diario-excluir-overlay');
  const popup   = document.getElementById('popup-diario-excluir');
  overlay.style.display = 'block'; popup.style.display = 'block';
  requestAnimationFrame(function() {
    popup.style.opacity = '1'; popup.style.transform = 'translate(-50%,-50%) scale(1)'; popup.style.pointerEvents = 'all';
  });
}

function fecharPopupDiarioExcluir() {
  const overlay = document.getElementById('popup-diario-excluir-overlay');
  const popup   = document.getElementById('popup-diario-excluir');
  popup.style.opacity = '0'; popup.style.transform = 'translate(-50%,-50%) scale(0.94)'; popup.style.pointerEvents = 'none';
  setTimeout(function() { popup.style.display = 'none'; overlay.style.display = 'none'; }, 200);
}

function _diarioExecutarExcluir() {
  const periodoId = _diarioExcluirPeriodoId;
  if (!periodoId) return;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(_DIARIO_CHAVE_SAIDAS + '_' + periodoId + '_')) toRemove.push(k);
  }
  toRemove.forEach(function(k){ localStorage.removeItem(k); });
  _diarioSalvarPeriodos(_diarioCarregarPeriodos().filter(function(p){ return p.id !== periodoId; }));
  fecharPopupDiarioExcluir();
  _diarioPeriodoAtual = 0;
  renderizarDiario();
  recalc(false, false); // devolve valor ao badge
}

function fecharConfig() {
  // Reverte toggles para o estado salvo caso o usuário feche sem salvar
  const salvo    = JSON.parse(localStorage.getItem("cfg_alerta_economia") || "false");
  const salvoCol = JSON.parse(localStorage.getItem("cfg_alerta_cor") || "true");
  if (_alertaPrevisaoAtivo !== salvo || _alertaCorAtivo !== salvoCol) {
    _alertaPrevisaoAtivo = salvo;
    _alertaCorAtivo      = salvoCol;
    _sincronizarToggle();
  }
  _configAberto = false;
  const overlay = document.getElementById("popup-config-overlay");
  const popup   = document.getElementById("popup-config");
  popup.style.opacity   = "0";
  popup.style.transform = "translateY(12px) scale(0.96)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    overlay.style.display = "none";
  }, 220);
}

function toggleAlertaPrevisao() {
  _alertaPrevisaoAtivo = !_alertaPrevisaoAtivo;
  // Só reseta o flag quando o usuário mexe no toggle pai,
  // permitindo o toast disparar novamente se reativar
  _alertaPrevisaoJaDisparado = false;
  _sincronizarToggle();
}

function toggleAlertaCor() {
  _alertaCorAtivo = !_alertaCorAtivo;
  _sincronizarToggle();
}

function salvarConfigAlerta() {
  const inp = document.getElementById("config-alerta-pct-input");
  let val = parseFloat(inp.value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 99) val = 99;
  _alertaPrevisaoPct = val;
  localStorage.setItem("cfg_alerta_economia", JSON.stringify(_alertaPrevisaoAtivo));
  localStorage.setItem("cfg_alerta_pct", val);
  localStorage.setItem("cfg_alerta_cor", JSON.stringify(_alertaCorAtivo));
  recalc(false, false);
  exibirToastInfo('Configurações salvas.', 2500);
}

function _sincronizarToggle() {
  const toggle    = document.getElementById("toggle-alerta");
  const thumb     = document.getElementById("toggle-alerta-thumb");
  const wrap      = document.getElementById("config-alerta-pct-wrap");
  const inp       = document.getElementById("config-alerta-pct-input");
  const toggleCor = document.getElementById("toggle-alerta-cor");
  const thumbCor  = document.getElementById("toggle-alerta-cor-thumb");
  if (!toggle) return;

  // Toggle pai
  toggle.style.background = _alertaPrevisaoAtivo ? "#3a6edc" : "#d0d8e8";
  thumb.style.left        = _alertaPrevisaoAtivo ? "24px" : "4px";

  // Expansão do painel filho
  if (_alertaPrevisaoAtivo) {
    wrap.style.maxHeight = "260px";
    wrap.style.opacity   = "1";
  } else {
    wrap.style.maxHeight = "0";
    wrap.style.opacity   = "0";
    // Desativa cor também ao desligar o pai
    _alertaCorAtivo = false;
  }

  // Toggle filho (cor) — só funciona se pai ativo
  if (toggleCor) {
    toggleCor.style.background = (_alertaPrevisaoAtivo && _alertaCorAtivo) ? "#3a6edc" : "#d0d8e8";
    toggleCor.style.opacity    = _alertaPrevisaoAtivo ? "1" : "0.4";
    toggleCor.style.pointerEvents = _alertaPrevisaoAtivo ? "auto" : "none";
  }
  if (thumbCor) {
    thumbCor.style.left = (_alertaPrevisaoAtivo && _alertaCorAtivo) ? "19px" : "3px";
  }

  // Só atualiza o input se o usuário não tiver digitado nada diferente
  if (inp) {
    const digitado = parseFloat(inp.value);
    if (isNaN(digitado) || digitado === _alertaPrevisaoPct) inp.value = _alertaPrevisaoPct;
    // se o usuário já digitou um valor diferente, preserva o que ele escreveu
  }
}

function _verificarAlertaPrevisao(previsaoPct, totalSal) {
  const elVal = document.getElementById("p-previsao");
  const elPct = document.getElementById("p-econpct");

  // Remove cor de alerta se configuração desligada
  if (!_alertaPrevisaoAtivo || totalSal <= 0) {
    if (elVal && elVal.classList.contains("alerta-config")) {
      elVal.classList.remove("alerta-config");
      elPct.classList.remove("alerta-config");
    }
    return;
  }

  const abaixo = previsaoPct < _alertaPrevisaoPct;

  if (abaixo) {
    // Cor só se toggle filho ativo
    if (_alertaCorAtivo) {
      elVal.className = "previsao-card-valor vermelho alerta-config";
      elPct.className = "previsao-card-pct vermelho alerta-config";
    }
    // Toast apenas na página mensal (não exibir no Diário)
    const _naPaginaMensal = document.getElementById('view-diario') &&
                            document.getElementById('view-diario').style.display === 'none';
    if (!_alertaPrevisaoJaDisparado && _naPaginaMensal) {
      _alertaPrevisaoJaDisparado = true;
      exibirToastSaldo(
        `Previsão de saldo abaixo de ${_alertaPrevisaoPct}% da receita.`,
        6000
      );
    }
  } else {
    _alertaPrevisaoJaDisparado = false;
    if (elVal && elVal.classList.contains("alerta-config")) {
      elVal.classList.remove("alerta-config");
      elPct.classList.remove("alerta-config");
    }
  }
}


/* ── 21. FECHAR / REABRIR MÊS (FECHAMENTO CONTÁBIL) ─────────────────────
 *  Chave no localStorage: "mes_fechado_ANO_MES" → "1" se fechado
 *
 *  Regras de fechamento:
 *    • Só pode fechar sequencialmente (não pode pular meses)
 *    • Ao fechar, todos os meses anteriores em aberto são fechados em cascata
 *    • Mês fechado → body.classList.add("mes-fechado") → CSS bloqueia edição
 *    • Para sacar da reserva/meta, TODOS os meses anteriores precisam estar fechados
 *
 *  Reabertura: remove a chave do localStorage (não apaga dados)
 * ────────────────────────────────────────────────────────────────────── */
/* ── FECHAR / REABRIR MÊS (FECHAMENTO CONTÁBIL) ────────────────────────
 *  Chave: "mes_fechado_ANO_MES" → "1" se fechado.
 *  Regras:
 *    • Só pode fechar sequencialmente (jan, fev, mar...)
 *    • Ao fechar, todos os anteriores em aberto fecham em cascata
 *    • body.classList.add("mes-fechado") → CSS bloqueia inputs/buttons
 *    • Sacar reserva/meta exige todos os anteriores fechados
 *  Reabertura: remove a chave (dados preservados).
 * ────────────────────────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════
   FECHAR / REABRIR MÊS
   Chave: "mes_fechado_AAAA_M" → "1" se fechado
   ══════════════════════════════════════════════════════ */

function _chaveMesFechado(ano, mes) {
  return "mes_fechado_" + ano + "_" + mes;
}

function mesFechado(ano, mes) {
  return localStorage.getItem(_chaveMesFechado(ano, mes)) === "1";
}

// Retorna o mês/ano do último mês fechado em sequência a partir de ANO_MIN/MES_MIN.
// Ex: se jan, fev e mar estão fechados mas abr não → último fechado = mar.
function _ultimoMesFechado() {
  // Varre todos os meses de ANO_MIN até o mês atual procurando a última sequência contínua
  let ultimoAno = null, ultimoMes = null;
  const anosRange = [2026, 2027, 2028, 2029, 2030];
  for (const a of anosRange) {
    for (let m = 0; m < 12; m++) {
      if (mesFechado(a, m)) {
        ultimoAno = a;
        ultimoMes = m;
      } else {
        // Sequência quebrada — para aqui
        return { ano: ultimoAno, mes: ultimoMes };
      }
    }
  }
  return { ano: ultimoAno, mes: ultimoMes };
}

// Regra 1: só pode fechar o mês IMEDIATAMENTE seguinte ao último fechado.
// Se nenhum fechado, só pode fechar o primeiro mês com dados (jan 2026).
// Retorna true se (ano, mes) pode ser fechado agora.
function _podeFecha(ano, mes) {
  const { ano: ua, mes: um } = _ultimoMesFechado();
  if (ua === null) {
    // Nenhum fechado ainda — só pode fechar o primeiro mês do planejamento (jan 2026)
    // OU qualquer mês, desde que seja o imediatamente anterior ao atual (permissivo: qualquer mês,
    // mas sequencial: tem que ser o próximo na fila = jan 2026 se nada fechado)
    return ano === 2026 && mes === 0;
  }
  // Próximo mês na sequência
  let proximoMes = um + 1;
  let proximoAno = ua;
  if (proximoMes > 11) { proximoMes = 0; proximoAno++; }
  return ano === proximoAno && mes === proximoMes;
}

// Regra 2: para sacar em (ano, mes), todos os meses ANTERIORES devem estar fechados.
// Janeiro 2026 não tem meses anteriores — não precisa de nenhum fechado.
function _todosAnterioresFechados(ano, mes) {
  // Varre todos os meses desde o início do planejamento até o mês anterior ao alvo
  const ANO_MIN = 2026;
  for (let a = ANO_MIN; a <= ano; a++) {
    const mFim = (a === ano) ? mes - 1 : 11;
    for (let m = 0; m <= mFim; m++) {
      if (!mesFechado(a, m)) return false;
    }
  }
  return true;
}

// Retorna o nome do último mês anterior ainda em aberto (fechar ele resolve tudo em cascata)
function _ultimoMesAberto(ano, mes) {
  const ANO_MIN = 2026;
  let nomeAberto = null;
  for (let a = ANO_MIN; a <= ano; a++) {
    const mFim = (a === ano) ? mes - 1 : 11;
    for (let m = 0; m <= mFim; m++) {
      if (!mesFechado(a, m)) {
        nomeAberto = meses[m] + (a !== ano ? " " + a : "");
      }
    }
  }
  return nomeAberto;
}

function _aplicarEstadoMesFechado() {
  const fechado = mesFechado(anoAtual, indice);
  const banner  = document.getElementById("mes-fechado-banner");
  const btnFch  = document.getElementById("btn-fechar-mes");

  // Banner
  if (banner) {
    banner.classList.toggle("visivel", fechado);
  }

  // Botão: troca ícone/tooltip e classe visual
  if (btnFch) {
    btnFch.classList.toggle("mes-fechado", fechado);
    const tooltip = btnFch.querySelector(".btn-replicar-mes-tooltip");
    if (tooltip) tooltip.textContent = fechado ? "Reabrir fechamento contábil" : "Fechamento contábil";
    btnFch.removeAttribute("title");
    // Redireciona clique conforme estado
    btnFch.onclick = fechado ? abrirPopupReabrirMes : abrirPopupFecharMes;
  }

  // Classe no body controla CSS de bloqueio de todos os inputs
  document.body.classList.toggle("mes-fechado", fechado);
}

/* ── Popup Fechar Mês ── */
function abrirPopupFecharMes() {
  if (mesFechado(anoAtual, indice)) return; // já fechado

  // Verifica quantos meses anteriores ainda estão abertos (serão fechados em cascata)
  const mesesAbertosAnteriores = [];
  const anosRange = [2026, 2027, 2028, 2029, 2030];
  for (const a of anosRange) {
    for (let m = 0; m < 12; m++) {
      if (a === anoAtual && m === indice) break;
      if (a > anoAtual) break;
      if (!mesFechado(a, m)) {
        mesesAbertosAnteriores.push({ ano: a, mes: m });
      }
    }
    if (a >= anoAtual) break;
  }
  // Também inclui meses anteriores no mesmo ano
  for (let m = 0; m < indice; m++) {
    if (!mesFechado(anoAtual, m)) {
      if (!mesesAbertosAnteriores.find(x => x.ano === anoAtual && x.mes === m)) {
        mesesAbertosAnteriores.push({ ano: anoAtual, mes: m });
      }
    }
  }

  const overlay = document.getElementById("popup-fechar-mes-overlay");
  const popup   = document.getElementById("popup-fechar-mes");
  const titulo  = document.getElementById("popup-fechar-mes-titulo");
  const sub     = document.getElementById("popup-fechar-mes-sub");
  if (titulo) titulo.textContent = "Fechamento contábil — " + meses[indice];
  if (sub) {
    if (mesesAbertosAnteriores.length > 0) {
      const nomes = mesesAbertosAnteriores.map(x => meses[x.mes] + (x.ano !== anoAtual ? " " + x.ano : "")).join(", ");
      sub.textContent = "Todos os meses anteriores em aberto também serão fechados: " + nomes + ".";
    } else {
      sub.textContent = "Este mês ficará bloqueado para edição.";
    }
  }
  if (!overlay || !popup) return;
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => {
    popup.style.opacity       = "1";
    popup.style.transform     = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "auto";
  });
}

function fecharPopupFecharMes() {
  const overlay = document.getElementById("popup-fechar-mes-overlay");
  const popup   = document.getElementById("popup-fechar-mes");
  if (!popup) return;
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.94)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    if (overlay) overlay.style.display = "none";
  }, 220);
}

function abrirPopupTour() {
  const overlay = document.getElementById("popup-tour-overlay");
  const popup   = document.getElementById("popup-tour");
  if (!popup) return;
  const isDiario = document.getElementById('view-diario') &&
                   document.getElementById('view-diario').style.display !== 'none';
  const btnIniciar = popup.querySelector('.btn-iniciar-tour');
  if (btnIniciar) {
    btnIniciar.onclick = function() {
      fecharPopupTour();
      if (isDiario) iniciarTourDiario();
      else iniciarTour();
    };
  }
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.style.opacity       = "1";
    popup.style.transform     = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "auto";
  }));
}

// ── TOUR DA PÁGINA DIÁRIO ──────────────────────────────────────────────────

// ── HELPER: monta a tabela fictícia dos passos 4/5 do tour do diário ──
// Recebe o objeto `passo` (contexto `this` do passo 4) para salvar os originais nele.
// Retorna imediatamente — não agenda nenhum highlight.
function _tourDiarioSetupTabelaFicticia(passo) {
  if (passo._setupFeito) return; // evita double-setup

  const vazioState = document.getElementById('diario-vazio-state');
  const ativoState = document.getElementById('diario-ativo-state');
  passo._eraVazio = vazioState && vazioState.style.display !== 'none';
  if (vazioState) vazioState.style.display = 'none';

  const wrap0 = document.getElementById('diario-wrap-0');
  passo._wrap0ClassList = wrap0 ? wrap0.className : '';
  if (wrap0) {
    wrap0.style.display = 'block';
    wrap0.classList.add('unico');
    passo._wrap0Unico = true;
    passo._wrap0Filter  = wrap0.style.filter;
    passo._wrap0Opacity = wrap0.style.opacity;
    wrap0.style.filter  = '';
    wrap0.style.opacity = '1';
  }

  const wrap1 = document.getElementById('diario-wrap-1');
  if (wrap1) { passo._wrap1Display = wrap1.style.display; wrap1.style.display = 'none'; }

  const colunas = document.getElementById('diario-colunas');
  if (colunas) { passo._colunasJustify = colunas.style.justifyContent; colunas.style.justifyContent = 'center'; }

  const btnEdit0 = wrap0 && wrap0.querySelector('.diario-periodo-btn-edit');
  const btnDel0  = wrap0 && wrap0.querySelector('.diario-periodo-btn-del');
  if (btnEdit0) { passo._btnEditDisplay = btnEdit0.style.display; btnEdit0.style.display = 'none'; }
  if (btnDel0)  { passo._btnDelDisplay  = btnDel0.style.display;  btnDel0.style.display  = 'none'; }
  passo._btnEdit0 = btnEdit0; passo._btnDel0 = btnDel0;

  const encEl = document.getElementById('diario-encerrado-0');
  if (encEl) { passo._encDisplay = encEl.style.display; encEl.style.display = 'none'; }
  passo._encEl = encEl;

  const tbodyImm = document.getElementById('diario-tbody-0');
  if (tbodyImm) { passo._tbodyOrigImm = tbodyImm.innerHTML; tbodyImm.innerHTML = ''; }
  const totalDispElImm = document.getElementById('diario-total-disp-0');
  if (totalDispElImm) { totalDispElImm.textContent = ''; }
  const totalSaidaElImm = document.getElementById('diario-total-saida-0');
  if (totalSaidaElImm) { totalSaidaElImm.textContent = ''; }

  const labelEl = document.getElementById('diario-periodo-label-0');
  if (labelEl) { passo._labelOrig = labelEl.textContent; labelEl.textContent = '15 Mai → 28 Mai 2026'; }
  const valorEl = document.getElementById('diario-periodo-valor-0');
  if (valorEl) { passo._valorOrig = valorEl.textContent; valorEl.textContent = 'R$ 200,00'; }

  const btn2add = document.getElementById('diario-add-segundo-btn');
  if (btn2add) { passo._btn2Display = btn2add.style.display; btn2add.style.display = 'none'; }

  const tbody = document.getElementById('diario-tbody-0');
  if (passo._tbodyOrigImm !== undefined) passo._tbodyOrig = passo._tbodyOrigImm;
  if (tbody) {
    tbody.innerHTML = '';
    const totalDias = 14;
    const limiteDiario = 200 / totalDias;
    const diasSemana = ['Dom','Seg','Ter','Qui','Sex','Sáb','Dom','Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
    const saidas = [12, 0, 18.5, 8, 0, 25, 11, 0, 14, 9.5, 0, 20, 7, 0];
    let dispAcum = 0;
    for (let d = 0; d < totalDias; d++) {
      const dia = 15 + d;
      const saida = saidas[d] || 0;
      dispAcum += limiteDiario - saida;
      const tr = document.createElement('tr');
      const tdData = document.createElement('td');
      tdData.textContent = String(dia).padStart(2,'0') + '/05/2026';
      tr.appendChild(tdData);
      const tdDia = document.createElement('td');
      tdDia.textContent = diasSemana[d];
      tr.appendChild(tdDia);
      const tdDisp = document.createElement('td');
      tdDisp.className = 'diario-td-disponivel' + (dispAcum < 0 ? ' negativo' : '');
      tdDisp.textContent = 'R$ ' + dispAcum.toFixed(2).replace('.',',');
      if (dispAcum >= 0) {
        const ratio = Math.min(dispAcum / 200, 1);
        const lightness = Math.round(72 - ratio * 36);
        tdDisp.style.color = 'hsl(120,' + Math.round(40 + ratio * 30) + '%,' + lightness + '%)';
      }
      tr.appendChild(tdDisp);
      const tdSaida = document.createElement('td');
      const cel = document.createElement('div');
      cel.className = 'diario-saida-cel';
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'diario-saida-input';
      input.placeholder = 'R$ 0,00'; input.readOnly = true;
      if (saida > 0) input.value = 'R$ ' + saida.toFixed(2).replace('.',',');
      cel.appendChild(input);
      tdSaida.appendChild(cel);
      tr.appendChild(tdSaida);
      tbody.appendChild(tr);
    }
  }

  const totalDispEl = document.getElementById('diario-total-disp-0');
  if (totalDispEl) { passo._totalDispOrig = totalDispEl.textContent; passo._totalDispColor = totalDispEl.style.color; totalDispEl.textContent = 'R$ 14,29'; totalDispEl.style.color = '#6effa0'; }
  const totalSaidaEl = document.getElementById('diario-total-saida-0');
  if (totalSaidaEl) { passo._totalSaidaOrig = totalSaidaEl.textContent; totalSaidaEl.textContent = 'R$ 125,00'; }

  if (ativoState) ativoState.style.display = 'block';
  passo._setupFeito = true;
}

const _tourPassosDiario = [

  // ── 0. INTRODUÇÃO DIÁRIO ──
  {
    titulo: 'Página Diário',
    desc: 'Depois de registrar os gastos fixos do mês, você pode criar períodos para controlar quanto deseja gastar em determinadas datas — muito útil para acompanhar os gastos entre o salário 1 e o salário 2.\n\nSe você usa apenas cartão de crédito, cadastre um único período da abertura até o fechamento da fatura. Assim fica fácil evitar ultrapassar o limite.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg = document.getElementById('tour-overlay');
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();
      _tourTimeout(function() {
        const balao = document.getElementById('tour-balao');
        if (balao) {
          const z = _getCssZoom();
          balao.style.left = (window.innerWidth  / z / 2 - balao.offsetWidth  / 2) + 'px';
          balao.style.top  = (window.innerHeight / z / 2 - balao.offsetHeight / 2) + 'px';
        }
        _mostrarBalao();
      }, 160);
    },
    onSair: function() { _clearTourTimers(); }
  },

  // ── 1. INTRODUÇÃO + BOTÃO CADASTRAR ──
  {
    titulo: 'Cadastre o primeiro período',
    desc: 'Depois de registrar os gastos fixos do mês, aqui você pode criar um período de datas para gastar um valor específico. Geralmente usamos essa página para anotar um valor que queremos gastar entre os dias que recebemos o salário 1 e o salário 2. Assim, você consegue acompanhar em tempo real se está conseguindo passar o mês conforme planejou.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';

      // Garante estado vazio visível (ativoState já foi escondido por _exibirPassoTourDiario)
      // _eraAtivo = true se havia listagem real antes do tour (ativoState foi escondido)
      const vazioState = document.getElementById('diario-vazio-state');
      const ativoState = document.getElementById('diario-ativo-state');
      this._eraAtivo = ativoState && ativoState.style.display === 'none';
      this._vazioState = vazioState;
      this._ativoState = ativoState;
      if (vazioState) vazioState.style.display = 'flex';

      _tourTimeout(function() {
        const btn = document.querySelector('.diario-vazio-btn');
        if (!btn) { _mostrarBalao(); return; }
        const z = _getCssZoom();
        const r = btn.getBoundingClientRect();
        const pad = 12;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x); hole.setAttribute('y', y);
        hole.setAttribute('width', w); hole.setAttribute('height', h);
        hole.setAttribute('rx', 8); hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y);
        border.setAttribute('width', w); border.setAttribute('height', h);
        border.setAttribute('rx', 8); border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        btn.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.35s';
        btn.style.transform  = 'scale(1.1)';
        btn.style.boxShadow  = '0 0 0 6px rgba(58,110,220,0.18)';
        _tourTimeout(function() {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '';
        }, 420);

        _posicionarBalao([btn]);
      }, 320);
    },
    onSair: function() {
      _clearTourTimers();
      const btn = document.querySelector('.diario-vazio-btn');
      if (btn) { btn.style.transition = ''; btn.style.transform = ''; btn.style.boxShadow = ''; }
      // Restaura ativoState apenas quando pular o tour (destino -1) ou sair do range 0-3
      // Se destino ainda está em 0-3, _exibirPassoTourDiario gerencia o ativoState
      const _passosComBloqueio = [0, 1, 2, 3, 4, 5, 6];
      if (!_passosComBloqueio.includes(_tourDiarioDestino) && this._eraAtivo) {
        if (this._vazioState) this._vazioState.style.display = 'none';
        if (this._ativoState) this._ativoState.style.display = 'block';
      }
    }
  },

  // ── 2. POPUP ABERTO — PERÍODO ──
  {
    titulo: 'Defina o intervalo de datas',
    desc: 'Preencha o período: a data de início é normalmente o dia em que você recebe o salário 1, e a data de fim é o dia anterior ao recebimento do salário 2. Por exemplo, do dia 5 ao dia 19.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const self = this;
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();
      // Esconde a tabela real para não aparecer atrás do popup durante o tour
      const _ativoStateP1 = document.getElementById('diario-ativo-state');
      if (_ativoStateP1 && _ativoStateP1.style.display !== 'none') {
        this._ativoStateDisplay = _ativoStateP1.style.display;
        _ativoStateP1.style.display = 'none';
        this._ativoStateEl = _ativoStateP1;
      }
      _abrirPopupDiarioTour();
      const popup        = document.getElementById('popup-diario');
      const popupOverlay = document.getElementById('popup-diario-overlay');
      const btnFechar    = popup && popup.querySelector('button[onclick="fecharPopupDiario()"]');
      if (popupOverlay) popupOverlay.style.display = 'none';
      if (btnFechar)    { btnFechar.style.display = 'none'; self._btnFechar = btnFechar; }
      self._popup = popup;
      _tourTimeout(function() {
        const alvo = document.getElementById('popup-diario-date-ini') &&
                     document.getElementById('popup-diario-date-ini').closest('.popup-meta-group');
        if (!alvo) { _mostrarBalao(); return; }
        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
        const z = _getCssZoom(), r = alvo.getBoundingClientRect(), pad = 8;
        const x = r.left/z-pad, y = r.top/z-pad, w = r.width/z+pad*2, h = r.height/z+pad*2;
        const hole = document.createElementNS(ns,'rect');
        hole.setAttribute('x',x); hole.setAttribute('y',y); hole.setAttribute('width',w); hole.setAttribute('height',h); hole.setAttribute('rx',8); hole.setAttribute('fill','black'); hole.classList.add('tour-dyn'); mask.appendChild(hole);
        const border = document.createElementNS(ns,'rect');
        border.setAttribute('x',x); border.setAttribute('y',y); border.setAttribute('width',w); border.setAttribute('height',h); border.setAttribute('rx',8); border.setAttribute('fill','none'); border.setAttribute('stroke','rgba(58,110,220,0.85)'); border.setAttribute('stroke-width','2.5'); border.classList.add('tour-dyn'); svg.appendChild(border);
        _posicionarBalao([alvo]);
      }, 400);
    },
    onSair: function() {
      _clearTourTimers();
      const svg = document.getElementById('tour-overlay');
      if (svg) svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      if (this._btnFechar) this._btnFechar.style.display = '';
      // Não restaura ativoState aqui — passo 2 continua com ele escondido
    }
  },

  // ── 3. POPUP — ENTRADA VINCULADA ──
  {
    titulo: 'Entrada vinculada',
    desc: 'Vincule o período à sua Entrada 1 ou Entrada 2. Isso indica de qual salário esse dinheiro vem, ajudando o sistema a calcular corretamente quanto sobrou ou quanto foi além do planejado.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const self = this;
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();
      // Esconde a tabela real para não aparecer atrás do popup
      const _ativoStateP2 = document.getElementById('diario-ativo-state');
      if (_ativoStateP2 && _ativoStateP2.style.display !== 'none') {
        this._ativoStateDisplay = _ativoStateP2.style.display;
        _ativoStateP2.style.display = 'none';
        this._ativoStateEl = _ativoStateP2;
      }
      // Popup já pode estar aberto do passo anterior — só garante que está visível
      const _popupJaAberto = document.getElementById('popup-diario') &&
                              document.getElementById('popup-diario').style.display !== 'none' &&
                              parseFloat(document.getElementById('popup-diario').style.opacity||'0') > 0.5;
      if (!_popupJaAberto) _abrirPopupDiarioTour();
      const popup        = document.getElementById('popup-diario');
      const popupOverlay = document.getElementById('popup-diario-overlay');
      const btnFechar    = popup && popup.querySelector('button[onclick="fecharPopupDiario()"]');
      if (popupOverlay) popupOverlay.style.display = 'none';
      if (btnFechar)    { btnFechar.style.display = 'none'; self._btnFechar = btnFechar; }
      self._popup = popup;
      _tourTimeout(function() {
        // Destaca só os botões Entrada 1 e 2, ignorando o espaço do info abaixo
        const btn1 = document.getElementById('popup-diario-entrada-1');
        const btn2 = document.getElementById('popup-diario-entrada-2');
        const alvo = btn1 && btn1.closest('.popup-meta-group');
        if (!alvo || !btn1 || !btn2) { _mostrarBalao(); return; }
        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
        const z = _getCssZoom();
        const r1 = btn1.getBoundingClientRect(), r2 = btn2.getBoundingClientRect();
        const labelEl = alvo.querySelector('.popup-meta-label');
        const rLabel = labelEl ? labelEl.getBoundingClientRect() : r1;
        const pad = 8;
        // Rect abrange do label até o último botão (excluindo o info de baixo)
        const top    = Math.min(rLabel.top, r1.top, r2.top)   / z - pad;
        const bottom = Math.max(r1.bottom, r2.bottom)          / z + pad;
        const left   = Math.min(rLabel.left, r1.left, r2.left) / z - pad;
        const right  = Math.max(rLabel.right, r1.right, r2.right) / z + pad;
        const r = { left: left*z, top: top*z, width: (right-left)*z, height: (bottom-top)*z };
        if (r.width === 0) { _mostrarBalao(); return; }
        const x = left, y = top, w = right - left, h = bottom - top;
        const hole = document.createElementNS(ns,'rect');
        hole.setAttribute('x',x); hole.setAttribute('y',y); hole.setAttribute('width',w); hole.setAttribute('height',h); hole.setAttribute('rx',8); hole.setAttribute('fill','black'); hole.classList.add('tour-dyn'); mask.appendChild(hole);
        const border = document.createElementNS(ns,'rect');
        border.setAttribute('x',x); border.setAttribute('y',y); border.setAttribute('width',w); border.setAttribute('height',h); border.setAttribute('rx',8); border.setAttribute('fill','none'); border.setAttribute('stroke','rgba(58,110,220,0.85)'); border.setAttribute('stroke-width','2.5'); border.classList.add('tour-dyn'); svg.appendChild(border);
        _posicionarBalao([btn1, btn2]);
      }, 400);
    },
    onSair: function() {
      _clearTourTimers();
      const svg = document.getElementById('tour-overlay');
      if (svg) svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      if (this._btnFechar) this._btnFechar.style.display = '';
      // Não restaura ativoState aqui — passo 3 continua com ele escondido
    }
  },

  // ── 4. POPUP — VALOR UTILIZADO ──
  {
    titulo: 'Valor utilizado',
    desc: 'Informe quanto você quer ter disponível para gastar nesse período. O sistema vai dividir esse valor pelos dias do intervalo, mostrando quanto você pode usar por dia. O que sobrar em um dia acumula para o próximo.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const self = this;
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();
      // Esconde a tabela real para não aparecer atrás do popup
      const _ativoStateP3 = document.getElementById('diario-ativo-state');
      if (_ativoStateP3 && _ativoStateP3.style.display !== 'none') {
        this._ativoStateDisplay = _ativoStateP3.style.display;
        _ativoStateP3.style.display = 'none';
        this._ativoStateEl = _ativoStateP3;
      }
      // Popup já pode estar aberto do passo anterior — só garante que está visível
      const _popupJaAberto2 = document.getElementById('popup-diario') &&
                               document.getElementById('popup-diario').style.display !== 'none' &&
                               parseFloat(document.getElementById('popup-diario').style.opacity||'0') > 0.5;
      if (!_popupJaAberto2) _abrirPopupDiarioTour();
      const popup        = document.getElementById('popup-diario');
      const popupOverlay = document.getElementById('popup-diario-overlay');
      const btnFechar    = popup && popup.querySelector('button[onclick="fecharPopupDiario()"]');
      if (popupOverlay) popupOverlay.style.display = 'none';
      if (btnFechar)    { btnFechar.style.display = 'none'; self._btnFechar = btnFechar; }
      self._popup = popup;
      _tourTimeout(function() {
        const alvo = document.getElementById('popup-diario-valor') &&
                     document.getElementById('popup-diario-valor').closest('.popup-meta-group');
        if (!alvo) { _mostrarBalao(); return; }
        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
        const z = _getCssZoom(), r = alvo.getBoundingClientRect(), pad = 8;
        if (r.width === 0) { _mostrarBalao(); return; }
        const x = r.left/z-pad, y = r.top/z-pad, w = r.width/z+pad*2, h = r.height/z+pad*2;
        const hole = document.createElementNS(ns,'rect');
        hole.setAttribute('x',x); hole.setAttribute('y',y); hole.setAttribute('width',w); hole.setAttribute('height',h); hole.setAttribute('rx',8); hole.setAttribute('fill','black'); hole.classList.add('tour-dyn'); mask.appendChild(hole);
        const border = document.createElementNS(ns,'rect');
        border.setAttribute('x',x); border.setAttribute('y',y); border.setAttribute('width',w); border.setAttribute('height',h); border.setAttribute('rx',8); border.setAttribute('fill','none'); border.setAttribute('stroke','rgba(58,110,220,0.85)'); border.setAttribute('stroke-width','2.5'); border.classList.add('tour-dyn'); svg.appendChild(border);
        _posicionarBalao([alvo]);
      }, 400);
    },
    onSair: function() {
      _clearTourTimers();
      const svg = document.getElementById('tour-overlay');
      if (svg) svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      if (this._btnFechar) this._btnFechar.style.display = '';
      // Não restaura ativoStateEl aqui — _exibirPassoTourDiario gerencia isso de forma centralizada
      this._ativoStateEl = null;
    }
  },

  // ── 5. TABELA — COLUNA DISPONÍVEL ──
  {
    titulo: 'Coluna Disponível',
    desc: 'A coluna "Disponível" mostra quanto você ainda pode gastar no dia. Ela acumula automaticamente o saldo que sobrou dos dias anteriores — se você gastou menos do que o limite, o restante fica disponível para o dia seguinte.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const self = this;
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      // Nota: _esconderBalao e limpar tour-dyn já foram feitos por _exibirPassoTourDiario

      // Monta tabela fictícia (salva originais em `this` para restaurar no onSair do passo 5)
      _tourDiarioSetupTabelaFicticia(this);

      // Ao retornar do passo 5 (setupFeito já era true), o setup não reaplicou os estilos
      // do tour — garante explicitamente que estão corretos antes do highlight
      const wrap0chk = document.getElementById('diario-wrap-0');
      if (wrap0chk) {
        if (!wrap0chk.classList.contains('unico')) wrap0chk.classList.add('unico');
        wrap0chk.style.filter  = '';
        wrap0chk.style.opacity = '1';
      }
      const colunasChk = document.getElementById('diario-colunas');
      if (colunasChk && colunasChk.style.justifyContent !== 'center') {
        colunasChk.style.justifyContent = 'center';
      }
      const btnEdit0chk = wrap0chk && wrap0chk.querySelector('.diario-periodo-btn-edit');
      const btnDel0chk  = wrap0chk && wrap0chk.querySelector('.diario-periodo-btn-del');
      if (btnEdit0chk) btnEdit0chk.style.display = 'none';
      if (btnDel0chk)  btnDel0chk.style.display  = 'none';
      const encEl0chk = document.getElementById('diario-encerrado-0');
      if (encEl0chk) encEl0chk.style.display = 'none';

      _tourTimeout(function() {
        const table = document.querySelector('#diario-wrap-0 .diario-table');
        if (!table) { _mostrarBalao(); return; }
        const ths = table.querySelectorAll('thead th');
        const thDisp = ths[2]; // "Disponível"
        if (!thDisp) { _mostrarBalao(); return; }

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
        const z = _getCssZoom();

        // Destaca apenas a coluna Disponível
        const tdsDisp = table.querySelectorAll('tbody td:nth-child(3), tfoot td:nth-child(3)');
        const allDisp = [thDisp, ...tdsDisp];
        const rects = allDisp.map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
        if (rects.length) {
          const pad = 4;
          const x = Math.min(...rects.map(r => r.left)) / z - pad;
          const y = Math.min(...rects.map(r => r.top))  / z - pad;
          const w = Math.max(...rects.map(r => r.right))  / z + pad - x;
          const h = Math.max(...rects.map(r => r.bottom)) / z + pad - y;
          const hole = document.createElementNS(ns,'rect');
          hole.setAttribute('x',x); hole.setAttribute('y',y); hole.setAttribute('width',w); hole.setAttribute('height',h); hole.setAttribute('rx',4); hole.setAttribute('fill','black'); hole.classList.add('tour-dyn'); mask.appendChild(hole);
          const border = document.createElementNS(ns,'rect');
          border.setAttribute('x',x); border.setAttribute('y',y); border.setAttribute('width',w); border.setAttribute('height',h); border.setAttribute('rx',4); border.setAttribute('fill','none'); border.setAttribute('stroke','rgba(58,110,220,0.85)'); border.setAttribute('stroke-width','2'); border.classList.add('tour-dyn'); svg.appendChild(border);
        }

        _posicionarBalaoEsquerdaDaColuna(allDisp.filter(e => e.getBoundingClientRect().width > 0));
      }, 300);
    },
    onSair: function() {
      _clearTourTimers();
      const svg = document.getElementById('tour-overlay');
      if (svg) svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      // Tabela fictícia permanece — passo 5 (Saída) a reutiliza
      // Cleanup completo fica no onSair do passo 5
      // Reseta flag apenas quando NÃO vai para o passo 5 (que reutiliza o setup)
      if (_tourDiarioDestino !== 6) this._setupFeito = false;
    }
  },

  // ── 6. TABELA — COLUNA SAÍDA ──
  {
    titulo: 'Coluna Saída',
    desc: 'A coluna "Saída" é onde você anota o quanto gastou no dia. Toque no campo e informe o valor — o sistema recalcula o saldo disponível em tempo real, atualizando todos os dias seguintes automaticamente.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';

      // Garante que a tabela fictícia está montada (passo 5 pode não ter rodado
      // se o usuário navegou direto para este passo pelo índice)
      const p4 = _tourPassosDiario[5];
      if (p4) _tourDiarioSetupTabelaFicticia(p4);

      // Garante que ativoState está visível
      const ativoState = document.getElementById('diario-ativo-state');
      if (ativoState) ativoState.style.display = 'block';

      _tourTimeout(function() {
        const table = document.querySelector('#diario-wrap-0 .diario-table');
        if (!table) { _mostrarBalao(); return; }
        const ths = table.querySelectorAll('thead th');
        const thSaida = ths[3]; // "Saída"
        if (!thSaida) { _mostrarBalao(); return; }

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
        const z = _getCssZoom();

        // Destaca apenas a coluna Saída
        const tdsSaida = table.querySelectorAll('tbody td:nth-child(4), tfoot td:nth-child(4)');
        const allSaida = [thSaida, ...tdsSaida];
        const rects = allSaida.map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
        if (rects.length) {
          const pad = 4;
          const x = Math.min(...rects.map(r => r.left)) / z - pad;
          const y = Math.min(...rects.map(r => r.top))  / z - pad;
          const w = Math.max(...rects.map(r => r.right))  / z + pad - x;
          const h = Math.max(...rects.map(r => r.bottom)) / z + pad - y;
          const hole = document.createElementNS(ns,'rect');
          hole.setAttribute('x',x); hole.setAttribute('y',y); hole.setAttribute('width',w); hole.setAttribute('height',h); hole.setAttribute('rx',4); hole.setAttribute('fill','black'); hole.classList.add('tour-dyn'); mask.appendChild(hole);
          const border = document.createElementNS(ns,'rect');
          border.setAttribute('x',x); border.setAttribute('y',y); border.setAttribute('width',w); border.setAttribute('height',h); border.setAttribute('rx',4); border.setAttribute('fill','none'); border.setAttribute('stroke','rgba(58,110,220,0.85)'); border.setAttribute('stroke-width','2'); border.classList.add('tour-dyn'); svg.appendChild(border);
        }

        _posicionarBalao(allSaida.filter(e => e.getBoundingClientRect().width > 0));
      }, 300);
    },
    onSair: function() {
      _clearTourTimers();
      const svg = document.getElementById('tour-overlay');
      if (svg) svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

      // Restaura botões de editar/excluir e banner encerrado (salvos pelo passo 4)
      // apenas quando NÃO volta para o passo 4, que mantém esses elementos ocultos
      const p4 = _tourPassosDiario[5];
      if (_tourDiarioDestino !== 5) {
        if (p4 && p4._btnEdit0) p4._btnEdit0.style.display = p4._btnEditDisplay || '';
        if (p4 && p4._btnDel0)  p4._btnDel0.style.display  = p4._btnDelDisplay  || '';
        if (p4 && p4._encEl)    p4._encEl.style.display     = p4._encDisplay     || '';
      }
      // Limpa flag de setup apenas quando NÃO volta para o passo 5 (que reutiliza o DOM montado)
      if (p4 && _tourDiarioDestino !== 5) p4._setupFeito = false;

      // Remove classe unico, restaura filter/opacity e justifyContent
      // apenas quando NÃO volta para o passo 5 — que precisa manter esses estilos ativos.
      const wrap0r = document.getElementById('diario-wrap-0');
      const colunas = document.getElementById('diario-colunas');
      if (_tourDiarioDestino !== 5) {
        if (wrap0r) {
          wrap0r.classList.remove('unico');
          if (p4 && p4._wrap0Filter  !== undefined) wrap0r.style.filter  = p4._wrap0Filter;
          if (p4 && p4._wrap0Opacity !== undefined) wrap0r.style.opacity = p4._wrap0Opacity;
        }
        if (colunas) colunas.style.justifyContent = '';
      }

      // Só reconstrói o diário se o destino NÃO for um dos passos que bloqueiam ativoState (0-5).
      const _passosComAtivoBloqueado = [0, 1, 2, 3, 4, 5];
      if (_passosComAtivoBloqueado.includes(_tourDiarioDestino)) {
        return;
      }

      // Deixa renderizarDiario reconstruir tudo do zero — estado real do sistema
      const _eraVazio = p4 && p4._eraVazio;
      if (_eraVazio) {
        const vazioState = document.getElementById('diario-vazio-state');
        const ativoState = document.getElementById('diario-ativo-state');
        if (ativoState) ativoState.style.display = 'none';
        if (vazioState) { vazioState.style.display = 'flex'; return; }
      }
      if (typeof renderizarDiario === 'function') renderizarDiario();
    }
  },

];

let _tourDiarioAtual = 0;

function iniciarTourDiario() {
  _tourDiarioAtual = 0;
  _tirarSnapshot();
  document.body.classList.add('tour-ativo');
  document.getElementById('tour-overlay').style.display = 'block';
  document.getElementById('tour-bloqueador').style.display = 'block';

  // Popula o menu lateral com os passos do diário
  const lista = document.getElementById('tour-indice-lista');
  if (lista) {
    lista.innerHTML = '';
    _tourPassosDiario.forEach(function(passo, i) {
      const titulo = passo.titulo || ('Etapa ' + (i + 1));
      const item = document.createElement('button');
      item.id = 'tour-indice-item-' + i;
      item.textContent = (i + 1) + '. ' + titulo;
      item.className = 'tour-indice-item';
      item.style.cssText = [
        'display:block;width:100%;text-align:left;background:none;border:none;',
        'border-radius:8px;padding:8px 12px;font-size:12px;font-weight:500;',
        'color:rgba(255,255,255,0.75);cursor:pointer;font-family:inherit;',
        'transition:background 0.15s,color 0.15s;line-height:1.4;'
      ].join('');
      item.onmouseover = function() { this.style.background='rgba(255,255,255,0.1)'; this.style.color='#fff'; };
      item.onmouseout  = function() {
        if (parseInt(this.id.split('-').pop()) !== _tourDiarioAtual) {
          this.style.background='none'; this.style.color='rgba(255,255,255,0.75)';
        }
      };
      item.onclick = function() { _tourDiarioIrPara(i); };
      lista.appendChild(item);
    });
  }

  // Cria botão flutuante
  var btnExistente = document.getElementById('tour-btn-indice');
  if (btnExistente) btnExistente.remove();
  var btn = document.createElement('button');
  btn.id = 'tour-btn-indice';
  btn.innerHTML = '☰ Etapas do tour';
  btn.onclick = tourToggleIndice;
  btn.style.cssText = 'display:none;position:fixed;top:62px;left:18px;z-index:2147483647;background:#3a6edc;border:none;border-radius:12px;padding:12px 20px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;color:#fff;';
  btn.className = 'tour-btn-indice-float';
  document.body.appendChild(btn);

  _tourDiarioUltimo = -1;
  _tourMenuEsconderDiario();
  _exibirPassoTourDiario(0);
}

function _tourMenuEsconderDiario() {
  const btn = document.getElementById('tour-btn-indice');
  if (btn) btn.style.display = 'none';
  tourFecharIndice();
}

function _tourMenuAtualizarDiario(idx) {
  const lista = document.getElementById('tour-indice-lista');
  if (!lista) return;
  lista.querySelectorAll('.tour-indice-item').forEach(function(item, i) {
    const ativo = i === idx;
    item.style.background = ativo ? 'rgba(58,110,220,0.35)' : 'none';
    item.style.color      = ativo ? '#fff' : 'rgba(255,255,255,0.75)';
    item.style.fontWeight = ativo ? '700' : '500';
  });
}

function _tourDiarioIrPara(idx) {
  tourFecharIndice();
  if (idx === _tourDiarioAtual) return;
  _tourDiarioDestino = idx; // seta destino ANTES do onSair para que ele possa decidir o que restaurar
  if (_tourPassosDiario[_tourDiarioAtual] && _tourPassosDiario[_tourDiarioAtual].onSair) _tourPassosDiario[_tourDiarioAtual].onSair();
  _tourDiarioAtual = idx;
  _exibirPassoTourDiario(_tourDiarioAtual);
}

function tourDiarioProximo() {
  if (_tourDiarioAtual < _tourPassosDiario.length - 1) {
    const btn = document.getElementById('tour-btn-indice');
    if (btn) btn.style.display = 'block';
    _tourDiarioAtual++;
    _exibirPassoTourDiario(_tourDiarioAtual);
  } else {
    tourPularDiario();
  }
}

function tourDiarioAnterior() {
  if (_tourDiarioAtual > 0) {
    _tourDiarioAtual--;
    _exibirPassoTourDiario(_tourDiarioAtual);
  }
}

function tourPularDiario() {
  _clearTourTimers();
  _tourRemoverSimulacao();
  fecharPopupDiario();
  // Sinaliza destino -1 para que onSair saiba que o tour está sendo encerrado
  _tourDiarioDestino = -1;
  if (_tourPassosDiario[_tourDiarioAtual] && _tourPassosDiario[_tourDiarioAtual].onSair) _tourPassosDiario[_tourDiarioAtual].onSair();
  const svg = document.getElementById('tour-overlay');
  svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
  svg.style.display = 'none';
  document.getElementById('tour-bloqueador').style.display = 'none';
  _esconderBalao();
  tourFecharIndice();
  const btnIndice = document.getElementById('tour-btn-indice');
  if (btnIndice) btnIndice.remove();
  document.body.classList.remove('tour-ativo');
  _restaurarSnapshot();
  // Reconstrói o diário do zero para desfazer qualquer DOM fictício injetado
  // pelo passo 4 (tbody, totais, label, classes), independente de qual passo estava ativo
  if (typeof renderizarDiario === 'function') renderizarDiario();
}

function _exibirPassoTourDiario(i) {
  // 1. Cancela timers pendentes
  _clearTourTimers();
  _tourRemoverSimulacao();

  const passo = _tourPassosDiario[i];
  if (!passo) return;

  // 2. Chama onSair do passo anterior (igual ao tour mensal)
  const passoAnterior = i > 0 ? _tourPassosDiario[i - 1] : (i < _tourPassosDiario.length - 1 ? _tourPassosDiario[i + 1] : null);
  // Na navegação, o passo que saiu já foi decrementado/incrementado antes de chamar esta função
  // Precisamos limpar o passo que estava ativo antes — usamos _tourDiarioUltimo
  const svg  = document.getElementById('tour-overlay');
  const mask = svg.querySelector('#tour-mask');

  // Limpa SVG ANTES de chamar onSair para evitar flash de highlight
  svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

  // Expõe o destino ANTES de chamar onSair para que ele possa decidir o que restaurar
  _tourDiarioDestino = i;

  if (typeof _tourDiarioUltimo === 'number' && _tourDiarioUltimo !== i) {
    const psair = _tourPassosDiario[_tourDiarioUltimo];
    if (psair && psair.onSair) psair.onSair.call(psair);
    // Se estava num passo com popup (1,2,3) e vai para fora desse range, fecha o popup
    const _passoComPopup = [1, 2, 3, 4];
    if (_passoComPopup.includes(_tourDiarioUltimo) && !_passoComPopup.includes(i)) {
      // Restaura o infoEl e fecha popup apenas ao sair completamente do range 1-3
      const infoEl2 = document.getElementById('popup-diario-entrada-info');
      if (infoEl2) { infoEl2.style.display = ''; infoEl2.style.height = ''; infoEl2.style.margin = ''; }
      const btnF = document.getElementById('popup-diario') &&
                   document.getElementById('popup-diario').querySelector('button[onclick="fecharPopupDiario()"]');
      if (btnF) btnF.style.display = '';
      // Restaura ativoState que foi escondido durante os passos do popup
      const ativoStateEl = document.getElementById('diario-ativo-state');
      if (ativoStateEl) ativoStateEl.style.display = 'block';
      fecharPopupDiario();
    }
  }
  _tourDiarioUltimo = i;

  // Se o destino é um passo que precisa do ativoState escondido durante a transição,
  // esconde IMEDIATAMENTE para não vazar durante o timeout de 280ms.
  // Passo 4 também entra aqui, mas apenas se a tabela fictícia ainda NÃO estiver montada
  // (ex: vindo do passo 5 de volta, o DOM já está pronto — não esconde para evitar flash).
  // Passo 5 NÃO está aqui: ele reutiliza a tabela fictícia do passo 4 e mantém ativoState visível.
  const _passosComAtivoBloqueado = [0, 1, 2, 3, 4, 5];
  const _p4setupJaFeito = i === 5 && _tourPassosDiario[5] && _tourPassosDiario[5]._setupFeito;
  if (_passosComAtivoBloqueado.includes(i) && !_p4setupJaFeito) {
    const ativoStateImm = document.getElementById('diario-ativo-state');
    if (ativoStateImm && ativoStateImm.style.display !== 'none') {
      ativoStateImm.style.display = 'none';
    }
  }

  _esconderBalao();

  // 280ms: suficiente para fecharPopupDiario (220ms) terminar antes de desenhar highlight
  _tourTimeout(function() {
    svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

    document.getElementById('tour-titulo').textContent    = passo.titulo;
    document.getElementById('tour-desc').textContent      = passo.desc;
    document.getElementById('tour-progresso').textContent = (i + 1) + ' / ' + _tourPassosDiario.length;
    _tourMenuAtualizarDiario(i);

    const btnAnt   = document.getElementById('tour-btn-ant');
    const btnProx  = document.getElementById('tour-btn-prox');
    const btnPular = document.getElementById('tour-btn-pular');
    btnAnt.style.display = i === 0 ? 'none' : 'flex';
    btnProx.textContent  = i === _tourPassosDiario.length - 1 ? '✓ Concluir' : 'Próximo →';
    btnProx.onclick      = tourDiarioProximo;
    btnAnt.onclick       = tourDiarioAnterior;
    if (btnPular) btnPular.onclick = tourPularDiario;

    if (passo.onEntrar) {
      passo.onEntrar.call(passo);
    } else {
      _mostrarBalao();
    }
  }, 280);
}

let _tourDiarioUltimo = -1;
let _tourDiarioDestino = -1;


function _posicionarBalaoAbaixoPopup() {
  const popup = document.getElementById('popup-diario');
  const balao = document.getElementById('tour-balao');
  if (!popup || !balao) return;
  const z      = _getCssZoom ? _getCssZoom() : 1;
  const r      = popup.getBoundingClientRect();
  const balaoW = balao.offsetWidth  || 300;
  const balaoH = balao.offsetHeight || 220;
  const vw     = window.innerWidth  / z;
  const vh     = window.innerHeight / z;
  const popR   = r.right  / z;
  const popT   = r.top    / z;
  const popB   = r.bottom / z;
  const popL   = r.left   / z;

  // Tenta posicionar à direita do popup
  if (popR + balaoW + 16 <= vw) {
    balao.style.left = (popR + 16) + 'px';
    let top = popT + (r.height / z / 2) - balaoH / 2;
    if (top < 12) top = 12;
    if (top + balaoH > vh - 12) top = vh - balaoH - 12;
    balao.style.top = top + 'px';
    return;
  }
  // Tenta à esquerda
  if (popL - balaoW - 16 >= 0) {
    balao.style.left = (popL - balaoW - 16) + 'px';
    let top = popT + (r.height / z / 2) - balaoH / 2;
    if (top < 12) top = 12;
    if (top + balaoH > vh - 12) top = vh - balaoH - 12;
    balao.style.top = top + 'px';
    return;
  }
  // Fallback: abaixo
  let left = popL + (r.width / z / 2) - balaoW / 2;
  if (left < 12) left = 12;
  if (left + balaoW > vw - 12) left = vw - balaoW - 12;
  let top = popB + 12;
  if (top + balaoH > vh - 12) top = popT - balaoH - 12;
  balao.style.left = left + 'px';
  balao.style.top  = top  + 'px';
}

function fecharPopupTour() {
  const overlay = document.getElementById("popup-tour-overlay");
  const popup   = document.getElementById("popup-tour");
  if (!popup) return;
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.94)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    if (overlay) overlay.style.display = "none";
  }, 220);
}

function confirmarFecharMes() {
  salvarMes(); // garante que tudo está salvo antes de fechar

  // Coleta dados do mês atual ANTES de fechar (para o resumo)
  const _resumoDados = _coletarDadosResumoMes(anoAtual, indice);

  // Fecha em cascata todos os meses anteriores que ainda estão abertos
  const anosRange = [2026, 2027, 2028, 2029, 2030];
  for (const a of anosRange) {
    for (let m = 0; m < 12; m++) {
      if (a === anoAtual && m > indice) break;
      if (a > anoAtual) break;
      if (!mesFechado(a, m)) {
        localStorage.setItem(_chaveMesFechado(a, m), "1");
      }
    }
    if (a >= anoAtual) break;
  }
  // Também fecha meses anteriores no mesmo ano
  for (let m = 0; m <= indice; m++) {
    if (!mesFechado(anoAtual, m)) {
      localStorage.setItem(_chaveMesFechado(anoAtual, m), "1");
    }
  }

  fecharPopupFecharMes();
  _aplicarEstadoMesFechado();

  // Se o diário estiver aberto, fecha e volta para o planejamento
  const elDiario = document.getElementById('view-diario');
  if (elDiario && elDiario.style.display !== 'none') {
    trocarAba('planejamento');
  }

  // Exibe o popup de resumo após o fechamento
  setTimeout(function() { _abrirPopupResumoMes(_resumoDados); }, 280);
}

/* ── Coleta os dados do mês para o popup de resumo ── */
function _coletarDadosResumoMes(ano, mes) {
  const chave = 'planejamento_' + ano + '_' + mes;
  const raw   = localStorage.getItem(chave);
  let dados   = {};
  try { dados = raw ? JSON.parse(raw) : {}; } catch(e) {}

  const sal1 = num(dados.sal1 || '');
  const sal2 = num(dados.sal2 || '');

  // Extras de salário
  const extrasRaw = localStorage.getItem('extras_sal_' + ano + '_' + mes);
  let extrasSoma  = 0;
  if (extrasRaw) {
    try {
      const ext = JSON.parse(extrasRaw);
      [1, 2].forEach(function(e) {
        const lista   = ext[String(e)] || [];
        const isSomar = ext['info' + e] === true;
        if (isSomar) lista.forEach(function(x) { extrasSoma += num(x.valor || ''); });
      });
    } catch(e) {}
  }
  const faturado = sal1 + sal2 + extrasSoma;

  // Gastos fixos
  let gastos = 0;
  Object.keys(dados).forEach(function(k) {
    if (k.endsWith('_val')) gastos += num(dados[k] || '');
  });

  // Alocações do diário
  try {
    const alocRaw = localStorage.getItem('diario_alocacao_v1');
    if (alocRaw) {
      const alocAll = JSON.parse(alocRaw);
      const alocMes = alocAll[ano + '_' + mes] || {};
      gastos += parseFloat(alocMes['1'] || 0) + parseFloat(alocMes['2'] || 0);
    }
  } catch(e) {}

  const saldo = faturado - gastos;

  // Depósito na reserva deste mês
  let depositoReserva = 0;
  try {
    const blocosRaw = localStorage.getItem('mov_previsao_blocos_' + ano + '_' + mes);
    if (blocosRaw) {
      const bl = JSON.parse(blocosRaw);
      depositoReserva = Math.max(0, (parseFloat(bl.depB1 || 0) + parseFloat(bl.depB2 || 0)) - (parseFloat(bl.retB1 || 0) + parseFloat(bl.retB2 || 0)));
    } else {
      depositoReserva = parseFloat(localStorage.getItem('dep_reserva_' + ano + '_' + mes) || '0');
    }
  } catch(e) {}

  // Depósito em metas deste mês
  let depositoMeta = 0;
  _META_KEYS.forEach(function(_, si) {
    depositoMeta += parseFloat(localStorage.getItem('dep_meta_' + si + '_' + ano + '_' + mes) || '0');
  });

  // Dados do mês anterior para comparação
  let anterior = null;
  let anoAnt = ano, mesAnt = mes - 1;
  if (mesAnt < 0) { mesAnt = 11; anoAnt--; }
  const rawAnt = localStorage.getItem('planejamento_' + anoAnt + '_' + mesAnt);
  if (rawAnt && mesFechado(anoAnt, mesAnt)) {
    try {
      const dAnt  = JSON.parse(rawAnt);
      const s1ant = num(dAnt.sal1 || '');
      const s2ant = num(dAnt.sal2 || '');
      const extAntRaw = localStorage.getItem('extras_sal_' + anoAnt + '_' + mesAnt);
      let extAntSoma = 0;
      if (extAntRaw) {
        const extA = JSON.parse(extAntRaw);
        [1, 2].forEach(function(e) {
          const lista = extA[String(e)] || [];
          if (extA['info' + e] === true) lista.forEach(function(x) { extAntSoma += num(x.valor || ''); });
        });
      }
      const fatAnt = s1ant + s2ant + extAntSoma;
      let gasAnt = 0;
      Object.keys(dAnt).forEach(function(k) { if (k.endsWith('_val')) gasAnt += num(dAnt[k] || ''); });
      try {
        const alocRawA = localStorage.getItem('diario_alocacao_v1');
        if (alocRawA) {
          const alocA = JSON.parse(alocRawA)[anoAnt + '_' + mesAnt] || {};
          gasAnt += parseFloat(alocA['1'] || 0) + parseFloat(alocA['2'] || 0);
        }
      } catch(e) {}
      anterior = { faturado: fatAnt, gastos: gasAnt, saldo: fatAnt - gasAnt, mes: mesAnt, ano: anoAnt };
    } catch(e) {}
  }

  return { faturado, gastos, saldo, depositoReserva, depositoMeta, mes, ano, anterior };
}

/* ── Abre o popup de resumo com os dados coletados ── */
function _abrirPopupResumoMes(d) {
  const overlay = document.getElementById('popup-resumo-mes-overlay');
  const popup   = document.getElementById('popup-resumo-mes');
  if (!overlay || !popup) return;

  const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Título
  document.getElementById('resumo-titulo-mes').textContent = MESES_NOMES[d.mes] + ' ' + d.ano;

  // Métricas principais
  document.getElementById('resumo-faturado').textContent = brl(d.faturado);
  document.getElementById('resumo-gastos').textContent   = brl(d.gastos);

  const saldoEl = document.getElementById('resumo-saldo');
  saldoEl.textContent = brl(Math.abs(d.saldo));
  saldoEl.className   = 'resumo-metrica-val ' + (d.saldo >= 0 ? 'azul' : 'vermelho');

  // Barra de proporção
  const pctGasto  = d.faturado > 0 ? Math.min((d.gastos / d.faturado) * 100, 100) : 0;
  const pctSobrou = Math.max(100 - pctGasto, 0);
  setTimeout(function() {
    document.getElementById('resumo-barra-gasto').style.width = pctGasto.toFixed(1) + '%';
  }, 80);
  document.getElementById('resumo-pct-gasto').textContent  = pctGasto.toFixed(0) + '% comprometido';
  const pctSobrouEl = document.getElementById('resumo-pct-sobrou');
  pctSobrouEl.textContent = pctSobrou.toFixed(0) + '% livre';
  pctSobrouEl.style.color = pctSobrou >= 20 ? '#16a34a' : (pctSobrou > 0 ? '#d97706' : '#c0392b');

  // Comparação com mês anterior
  const compEl = document.getElementById('resumo-comparacao');
  if (d.anterior) {
    const diffGastos = d.gastos - d.anterior.gastos;
    const diffSaldo  = d.saldo  - d.anterior.saldo;
    const seta = function(v) { return v > 0 ? '▲' : (v < 0 ? '▼' : '—'); };
    const cor  = function(v, inverso) {
      if (v === 0) return '#8a9cc8';
      const positivo = inverso ? v < 0 : v > 0;
      return positivo ? '#16a34a' : '#c0392b';
    };
    const compGastosEl = document.getElementById('resumo-comp-gastos');
    const compSaldoEl  = document.getElementById('resumo-comp-saldo');
    const nomeMesAnt   = MESES_NOMES[d.anterior.mes];

    compGastosEl.innerHTML = `<span style="color:${cor(diffGastos, true)}">${seta(diffGastos)} ${brl(Math.abs(diffGastos))}</span> <span style="font-size:11px;color:#8a9cc8;font-weight:400;">vs. ${nomeMesAnt}</span>`;
    compSaldoEl.innerHTML  = `<span style="color:${cor(diffSaldo, false)}">${seta(diffSaldo)} ${brl(Math.abs(diffSaldo))}</span> <span style="font-size:11px;color:#8a9cc8;font-weight:400;">vs. ${nomeMesAnt}</span>`;
    compEl.style.display = '';
  } else {
    compEl.style.display = 'none';
  }

  // Reserva / meta guardada
  const reservaRow = document.getElementById('resumo-reserva-row');
  const reservaConteudo = document.getElementById('resumo-reserva-conteudo');
  if (d.depositoReserva > 0 || d.depositoMeta > 0) {
    let linhas = [];
    if (d.depositoReserva > 0) linhas.push('<span style="display:inline-flex;align-items:center;gap:6px;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a16207" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="16" rx="2"/><circle cx="12" cy="11" r="3.5"/><circle cx="12" cy="11" r="1.2" fill="#a16207" stroke="none"/></svg>Reserva de emergência: <strong>' + brl(d.depositoReserva) + '</strong></span>');
    if (d.depositoMeta > 0)    linhas.push('<span style="display:inline-flex;align-items:center;gap:6px;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1c3f91" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="#1c3f91" stroke="none"/></svg>Metas: <strong>' + brl(d.depositoMeta) + '</strong></span>');
    reservaConteudo.innerHTML = linhas.join('<br>');
    reservaRow.style.display = '';
  } else {
    reservaRow.style.display = 'none';
  }

  overlay.style.display = 'block';
  popup.style.display   = 'block';
  requestAnimationFrame(function() {
    popup.style.opacity       = '1';
    popup.style.transform     = 'translate(-50%,-50%) scale(1)';
    popup.style.pointerEvents = 'auto';
  });
}

function fecharPopupResumoMes() {
  const overlay = document.getElementById('popup-resumo-mes-overlay');
  const popup   = document.getElementById('popup-resumo-mes');
  if (!popup) return;
  popup.style.opacity       = '0';
  popup.style.transform     = 'translate(-50%,-50%) scale(0.94)';
  popup.style.pointerEvents = 'none';
  // Reseta barra para próxima abertura
  const barra = document.getElementById('resumo-barra-gasto');
  if (barra) barra.style.width = '0%';
  setTimeout(function() {
    popup.style.display   = 'none';
    if (overlay) overlay.style.display = 'none';
  }, 250);
}

/* ── Popup Reabrir Mês ── */
function abrirPopupReabrirMes() {
  const overlay = document.getElementById("popup-reabrir-mes-overlay");
  const popup   = document.getElementById("popup-reabrir-mes");
  if (!overlay || !popup) return;
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => {
    popup.style.opacity       = "1";
    popup.style.transform     = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "auto";
  });
}

function fecharPopupReabrirMes() {
  const overlay = document.getElementById("popup-reabrir-mes-overlay");
  const popup   = document.getElementById("popup-reabrir-mes");
  if (!popup) return;
  popup.style.opacity       = "0";
  popup.style.transform     = "translate(-50%,-50%) scale(0.94)";
  popup.style.pointerEvents = "none";
  setTimeout(() => {
    popup.style.display   = "none";
    if (overlay) overlay.style.display = "none";
  }, 220);
}

function confirmarReabrirMes() {
  localStorage.removeItem(_chaveMesFechado(anoAtual, indice));
  fecharPopupReabrirMes();
  _aplicarEstadoMesFechado();
  exibirToastInfo(meses[indice] + " reaberto. Edições liberadas.", 4000);
}

/* ── 24. EXPORTAR / IMPORTAR DADOS ─────────────────────────────────────
 *  exportarDados(): cria um arquivo JSON com todas as chaves relevantes
 *    do localStorage e força download no navegador.
 *    Prefixos exportados: planejamento_, mov_previsao_, cobrir_valor_,
 *    dep_reserva_, dep_meta_, mes_fechado_, diario_, simulador_reserva_,
 *    reserva_saldo_v1, reserva_meta_v2*, cfg_*
 *  importarDados(input): lê o .json, mostra popup de confirmação e
 *    substitui TODOS os dados atuais (ação irreversível).
 *    A flag _importacaoEmAndamento impede que o beforeunload grave
 *    os campos zerados durante a importação.
 * ────────────────────────────────────────────────────────────────────── */
/* ── EXPORTAR / IMPORTAR DADOS ─────────────────────────────────────────
 *  exportarDados(): JSON com todas as chaves relevantes → download no browser.
 *  importarDados(): lê .json, pede confirmação e substitui TUDO (irreversível).
 *  _importacaoEmAndamento: bloqueia beforeunload durante a importação.
 * ────────────────────────────────────────────────────────────────────── */
/* ── EXPORTAR / IMPORTAR DADOS ── */

function exportarDados() {
  // Garante que edições em tela (ainda no debounce) sejam gravadas antes de exportar
  clearTimeout(_salvoDebounce);
  salvarMes();

  const prefixos = [
    'planejamento_', // aba 'Mensal' na UI
    'extras_sal_',
    'mov_previsao_',
    'mov_previsao_blocos_',
    'cobrir_valor_',
    'dep_reserva_',
    'dep_meta_',
    'cobrir_previsao_',
    'mes_fechado_',
    'diario_',            // aba Diário: lançamentos diários + limites (diario_limite_mensal_*)
    'simulador_reserva_', // simulador de reserva por ano
  ];
  const chavesFixas = [
    'categorias_personalizadas',
    'reserva_saldo_v1',
    'reserva_meta_v2',
    'reserva_meta_v2_b',
    'reserva_meta_v2_c',
    'cfg_alerta_economia',
    'cfg_alerta_pct',
    'cfg_alerta_cor',
  ];

  const backup = { _versao: 1, _exportadoEm: new Date().toISOString(), dados: {} };

  chavesFixas.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) backup.dados[k] = v;
  });

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (prefixos.some(p => k.startsWith(p))) {
      backup.dados[k] = localStorage.getItem(k);
    }
  }

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');

  // Nome automático com data no formato YYYY-MM-DD para ordenação correta
  const hoje = new Date();
  const ano  = hoje.getFullYear();
  const mes  = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia  = String(hoje.getDate()).padStart(2, '0');
  a.href     = url;
  a.download = `Planôva-${dia}-${mes}-${ano}.json`;

  // Dispara download direto para a pasta Downloads — sem diálogo de "onde salvar"
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  exibirToastInfo('Backup salvo na pasta Downloads!', 4000);
}

/* ── Popup interno de confirmação de importação ── */
let _importarBackupPendente = null;

function _abrirPopupImportar(backupObj) {
  _importarBackupPendente = backupObj;
  const overlay = document.getElementById('popup-importar-overlay');
  const popup   = document.getElementById('popup-importar-confirm');
  overlay.style.display = 'block';
  popup.style.display   = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    popup.style.opacity      = '1';
    popup.style.transform    = 'translate(-50%,-50%) scale(1)';
    popup.style.pointerEvents = 'auto';
  }));
}

function _fecharPopupImportar() {
  const overlay = document.getElementById('popup-importar-overlay');
  const popup   = document.getElementById('popup-importar-confirm');
  popup.style.opacity      = '0';
  popup.style.transform    = 'translate(-50%,-50%) scale(0.94)';
  popup.style.pointerEvents = 'none';
  setTimeout(() => {
    popup.style.display   = 'none';
    overlay.style.display = 'none';
    _importarBackupPendente = null;
  }, 200);
}

function _confirmarImportacao() {
  if (!_importarBackupPendente) return;
  _importacaoEmAndamento = true; // bloqueia o beforeunload de sobrescrever os dados
  clearTimeout(_salvoDebounce);  // cancela qualquer salvarMes agendado pelo debounce

  // Apaga todas as chaves do app ANTES de gravar o backup.
  // Sem isso, chaves que não existem no backup (ex: meses que o usuário
  // apagou após exportar) continuariam no localStorage como dados fantasma.
  const prefixosApp = [
    'planejamento_', 'mov_previsao_', 'cobrir_valor_', 'dep_reserva_',
    'dep_meta_', 'cobrir_previsao_', 'mes_fechado_', 'diario_', 'simulador_reserva_', 'extras_sal_',
  ];
  const chavesFixasApp = [
    'categorias_personalizadas',
    'reserva_saldo_v1', 'reserva_meta_v2', 'reserva_meta_v2_b', 'reserva_meta_v2_c',
    'cfg_alerta_economia', 'cfg_alerta_pct', 'cfg_alerta_cor',
  ];
  const aRemover = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (prefixosApp.some(p => k.startsWith(p)) || chavesFixasApp.includes(k)) {
      aRemover.push(k);
    }
  }
  aRemover.forEach(k => localStorage.removeItem(k));

  // Grava os dados do backup
  try {
    Object.entries(_importarBackupPendente.dados).forEach(([k, v]) => {
      localStorage.setItem(k, v);
    });
  } catch (e) {
    // QuotaExceededError ou outro erro de armazenamento
    _importacaoEmAndamento = false;
    exibirToastSaldo('Erro ao restaurar: armazenamento insuficiente no navegador. Tente limpar o cache e importar novamente.', 7000);
    return;
  }
  _fecharPopupImportar();
  exibirToastInfo('Backup importado! Recarregando...', 3000);
  setTimeout(() => location.reload(), 1500);
}

function importarDados(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const reader = new FileReader();
  reader.onload = function(e) {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch {
      exibirToastSaldo('Arquivo inválido. Use um backup exportado por este app.', 5000);
      return;
    }

    // typeof null === 'object' em JS, por isso a verificação extra de null e Array
    if (!backup || !backup.dados || typeof backup.dados !== 'object' || backup.dados === null || Array.isArray(backup.dados)) {
      exibirToastSaldo('Arquivo inválido. Use um backup exportado por este app.', 5000);
      return;
    }

    _abrirPopupImportar(backup);
  };
  reader.onerror = function() {
    exibirToastSaldo('Não foi possível ler o arquivo. Tente novamente.', 5000);
  };
  reader.readAsText(file);
}

/* Botões do popup de importação já têm onclick no HTML — addEventListener removido para evitar disparo duplo */
/* ══════════════════════════════════════════
   DIÁRIO — lógica completa
══════════════════════════════════════════ */

const bancosListaDiario = ["","Banco do Brasil","Banco PAN","Bradesco","BTG Pactual","C6 Bank","Caixa","Inter","Itaú","Mercado Pago","Nubank","Original","PagBank","Picpay","Santander","Sicredi"];

// 'planejamento' é o id interno da aba chamada 'Mensal' na interface.
// Usar 'planejamento' aqui é intencional para não quebrar o localStorage.
let _mudarAbaEmAndamento = false;

function mudarAba(aba) {
  if (_mudarAbaEmAndamento) return;

  const elMes     = document.getElementById('view-mes-container');
  const elBanner  = document.getElementById('mes-fechado-banner');
  const elLayout  = document.getElementById('view-main-layout');
  const elDiario  = document.getElementById('view-diario');
  const elAnual   = document.getElementById('view-anual');
  const fabMensal = document.getElementById('fab-mensal');
  const fabDiario = document.getElementById('fab-diario');
  const tabP      = document.getElementById('tab-planejamento');
  const tabD      = document.getElementById('tab-diario');
  const tabA      = document.getElementById('tab-anual');

  // Detecta aba atual com base em qual view está visível
  let abaAtual = 'planejamento';
  if (elDiario && elDiario.style.display !== 'none') abaAtual = 'diario';
  else if (elAnual && elAnual.style.display !== 'none') abaAtual = 'anual';

  if (aba === abaAtual) return;

  _mudarAbaEmAndamento = true;
  clearTimeout(_salvoDebounce);
  salvarMes();

  // Atualiza tabs
  if (tabP) tabP.classList.remove('ativo');
  if (tabD) tabD.classList.remove('ativo');
  if (tabA) tabA.classList.remove('ativo');
  if (aba === 'planejamento' && tabP) tabP.classList.add('ativo');
  if (aba === 'diario'       && tabD) tabD.classList.add('ativo');
  if (aba === 'anual'        && tabA) tabA.classList.add('ativo');

  // Elementos a esconder (view atual)
  const elsAtual = [];
  if (abaAtual === 'diario') {
    if (elDiario) elsAtual.push(elDiario);
  } else if (abaAtual === 'anual') {
    if (elAnual) elsAtual.push(elAnual);
  } else {
    if (elMes)    elsAtual.push(elMes);
    if (elLayout) elsAtual.push(elLayout);
    if (elBanner && elBanner.style.display !== 'none') elsAtual.push(elBanner);
  }

  // Elementos a mostrar (view destino)
  const elsDestino = [];
  if (aba === 'diario') {
    if (elDiario) elsDestino.push(elDiario);
  } else if (aba === 'anual') {
    if (elAnual) elsDestino.push(elAnual);
  } else {
    if (elMes)    elsDestino.push(elMes);
    if (elLayout) elsDestino.push(elLayout);
  }

  const FADE_MS = 130;

  // Fase 1: fade out da view atual
  elsAtual.forEach(el => {
    el.style.transition    = `opacity ${FADE_MS}ms ease`;
    el.style.opacity       = '0';
    el.style.pointerEvents = 'none';
  });

  setTimeout(() => {
    // Fase 2: esconde view atual
    elsAtual.forEach(el => {
      el.style.display       = 'none';
      el.style.opacity       = '';
      el.style.transition    = '';
      el.style.pointerEvents = '';
    });

    // FABs
    if (aba === 'diario') {
      if (fabMensal) fabMensal.style.display = 'none';
      if (fabDiario) fabDiario.style.display = 'flex';
    } else {
      if (fabDiario) fabDiario.style.display = 'none';
      if (fabMensal) fabMensal.style.display = aba === 'anual' ? 'none' : 'flex';
    }

    // Fase 3: prepara view destino (invisível)
    elsDestino.forEach(el => {
      el.style.opacity    = '0';
      el.style.transition = 'none';
      el.style.display    = (el === elDiario || el === elAnual) ? 'block' : 'flex';
    });
    if (aba === 'planejamento' && elBanner) elBanner.style.display = '';

    // Bloqueia scroll do body na página anual
    document.body.classList.toggle('pagina-anual', aba === 'anual');

    // Carrega dados da view destino
    if (aba === 'diario')       renderizarDiario();
    if (aba === 'anual')        { _anualAno = new Date().getFullYear(); anualCarregar(); }
    if (aba === 'planejamento') carregarMes();

    // Fase 4: fade in da view destino
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        elsDestino.forEach(el => {
          el.style.transition = `opacity ${FADE_MS}ms ease`;
          el.style.opacity    = '1';
        });
        setTimeout(() => {
          elsDestino.forEach(el => {
            el.style.transition = '';
            el.style.opacity    = '';
          });
          _mudarAbaEmAndamento = false;
        }, FADE_MS);
      });
    });

  }, FADE_MS);
}

function trocarAba(aba) { mudarAba(aba); }

/* ── DROPDOWN DE MÊS NO DIÁRIO ── */
(function() {
  const lista = document.getElementById('diario-mes-dropdown-list');
  if (!lista) return;
  meses.forEach((nome, i) => {
    const item = document.createElement('div');
    const _mesHojeDC = new Date().getMonth();
    const _anoHojeDC  = new Date().getFullYear();
    item.className = 'diario-mes-dropdown-item' + (i === indice ? ' ativo' : '') + (i === _mesHojeDC && anoAtual === _anoHojeDC ? ' hoje' : '');
    item.textContent = nome;
    item.addEventListener('click', () => {
      if (i === indice) { fecharDiarioMesDropdown(); return; }
      clearTimeout(_changeMonthPendente);
      clearTimeout(_salvoDebounce);
      if (_indiceVisual === null) salvarMes();
      _indiceVisual = null; _anoVisual = null;
      indice = i;
      popupAvisoJaExibido = false;
      toastAvisoAtivo = false;
      _toastJaExibidoParaEsteSalario = false;
      atualizarAvisoIcone(false);
      fecharDiarioMesDropdown();
      document.getElementById('titulomes').innerText = meses[i];
      document.getElementById('ano-label').textContent = anoAtual;
      atualizarEstiloItensAno();
      _atualizarDiarioTituloMes();
      document.querySelectorAll('.val-input').forEach(inp => inp.value = '');
      document.querySelectorAll('.linha select').forEach(s => s.value = '');
      document.querySelectorAll('.linha input[type=checkbox]').forEach(c => c.checked = false);
      document.getElementById('sal1').value = '';
      document.getElementById('sal2').value = '';
      document.querySelectorAll('.linha').forEach(l => { l._subcategoria = ''; });
      carregarMes();
    });
    lista.appendChild(item);
  });
})();

function _atualizarDiarioTituloMes() {
  const el = document.getElementById('diario-titulomes');
  if (el) el.textContent = meses[indice];
  const lista = document.getElementById('diario-mes-dropdown-list');
  if (lista) {
    const _mesHojeDU = new Date().getMonth();
    const _anoHojeDU  = new Date().getFullYear();
    lista.querySelectorAll('.diario-mes-dropdown-item').forEach((item, i) => {
      item.classList.toggle('ativo', i === indice);
      item.classList.toggle('hoje', i === _mesHojeDU && anoAtual === _anoHojeDU);
    });
  }
}

function toggleDiarioMesDropdown() {
  const lista = document.getElementById('diario-mes-dropdown-list');
  const wrap  = document.getElementById('diario-mes-dropdown-wrap');
  if (!lista || !wrap) return;
  const aberto = lista.classList.toggle('open');
  wrap.classList.toggle('aberto', aberto);
  const _mesHojeDT = new Date().getMonth();
  const _anoHojeDT  = new Date().getFullYear();
  lista.querySelectorAll('.diario-mes-dropdown-item').forEach((el, i) => {
    el.classList.toggle('ativo', i === indice);
    el.classList.toggle('hoje', i === _mesHojeDT && anoAtual === _anoHojeDT);
  });
}

function fecharDiarioMesDropdown() {
  const lista = document.getElementById('diario-mes-dropdown-list');
  const wrap  = document.getElementById('diario-mes-dropdown-wrap');
  if (lista) lista.classList.remove('open');
  if (wrap)  wrap.classList.remove('aberto');
}

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('diario-mes-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) fecharDiarioMesDropdown();
});

function getDiasNoMes(ano, mes) {
  return new Date(ano, mes + 1, 0).getDate();
}

function formatarDataDiario(ano, mes, dia) {
  const d = String(dia).padStart(2,'0');
  const m = String(mes + 1).padStart(2,'0');
  return `${d}/${m}/${ano}`;
}

/* Fecha qualquer select-banco-list aberto ao clicar fora */
document.addEventListener('click', () => {
  document.querySelectorAll('.select-banco-list.open').forEach(l => l.classList.remove('open'));
});
/* ══════════════════════════════════════════
   SIMULADOR ANUAL DE RESERVA
   ══════════════════════════════════════════ */
const MESES_SIM = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function _chaveSimulador() {
  return 'simulador_reserva_' + anoAtual;
}

function _carregarDadosSim() {
  try {
    const raw = localStorage.getItem(_chaveSimulador());
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return MESES_SIM.map(() => ({ entrada: 0, saida: 0 }));
}

function _salvarDadosSim(dados) {
  localStorage.setItem(_chaveSimulador(), JSON.stringify(dados));
}

function _recalcularSim() {
  const dados = _carregarDadosSim();
  const tbody = document.getElementById('simulador-tbody');
  if (!tbody) return;

  let acumulado = 0;
  let totalEntrada = 0;
  let totalSaida = 0;

  Array.from(tbody.querySelectorAll('tr')).forEach((tr, i) => {
    const inicial = acumulado;
    const entrada = dados[i] ? dados[i].entrada : 0;
    const saida   = dados[i] ? dados[i].saida   : 0;
    acumulado = inicial + entrada - saida;
    totalEntrada += entrada;
    totalSaida   += saida;

    tr.querySelector('.sim-cel-inicial').textContent  = brl(inicial);
    tr.querySelector('.sim-cel-total').textContent    = brl(acumulado);
    tr.querySelector('.sim-cel-total').style.color    = acumulado >= 0 ? '#1f7a1f' : 'rgb(201,0,0)';
  });

  document.getElementById('sim-total-entrada').textContent   = brl(totalEntrada);
  document.getElementById('sim-total-saida').textContent     = brl(totalSaida);
  document.getElementById('sim-total-acumulado').textContent = brl(acumulado);
}


function _renderizarSimulador() {
  const dados = _carregarDadosSim();
  const tbody = document.getElementById('simulador-tbody');
  tbody.innerHTML = '';

  function criarCelula(tipo, idx, valor) {
    // tipo: 'entrada' | 'saida'
    const isEntrada = tipo === 'entrada';
    const td = document.createElement('td');
    td.className = 'sim-td-cel';
    td.style.cssText = 'position:relative;padding:4px 0;text-align:center;';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sim-input ' + (isEntrada ? 'sim-input-entrada' : 'sim-input-saida');
    input.placeholder = 'R$ 0,00';
    input.autocomplete = 'off';
    input.value = valor > 0 ? brl(valor) : '';
    input.addEventListener('input', function() { fmtInput(this); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') this.blur(); });
    input.addEventListener('blur', function() {
      fmt(this);
      const d2 = _carregarDadosSim();
      d2[idx][tipo] = num(this.value);
      _salvarDadosSim(d2);
      _recalcularSim();


    });

    // Botão ×
    const btnX = document.createElement('button');
    btnX.className = 'sim-limpar-btn' + (isEntrada ? ' sim-limpar-entrada' : '');
    btnX.innerHTML = '×';
    btnX.title = ''; const ttX = document.createElement('span'); ttX.className = 'sim-tooltip sim-tooltip-del'; ttX.textContent = 'Excluir restante'; btnX.appendChild(ttX);

    btnX.addEventListener('click', () => {
      input.value = '';
      const d2 = _carregarDadosSim();
      d2[idx][tipo] = 0;
      _salvarDadosSim(d2);
      _recalcularSim();


    });

    // Botão replicar ⟳
    const btnRep = document.createElement('button');
    btnRep.className = 'sim-replicar-btn' + (isEntrada ? ' sim-replicar-entrada' : '');
    btnRep.innerHTML = '⟳';
    btnRep.title = ''; const ttRep = document.createElement('span'); ttRep.className = 'sim-tooltip sim-tooltip-rep'; ttRep.textContent = 'Replicar restante'; btnRep.appendChild(ttRep);

    btnRep.addEventListener('click', () => {
      const val = num(input.value);
      if (!val) return;
      const d2 = _carregarDadosSim();
      d2.forEach((m, j) => { if (j >= idx) m[tipo] = val; });
      _salvarDadosSim(d2);
      _renderizarSimulador();
    });

    const inner = document.createElement("div");
    inner.className = "sim-td-cel-inner";
    inner.appendChild(input);
    inner.appendChild(btnRep);
    inner.appendChild(btnX);
    td.appendChild(inner);
    return td;
  }

  MESES_SIM.forEach((mes, i) => {
    const d = dados[i] || { entrada: 0, saida: 0 };
    const tr = document.createElement('tr');
    tr.style.transition = 'background 0.12s';
    tr.onmouseover = () => tr.style.background = '';
    tr.onmouseout  = () => tr.style.background = '';
    tr.className = 'sim-row';

    const tdMes = document.createElement('td');
    tdMes.textContent = mes;
    tdMes.className = 'sim-cel-mes';
    tdMes.style.cssText = 'padding:6px 0;font-weight:600;font-size:12px;text-align:center;';

    const tdInicial = document.createElement('td');
    tdInicial.className = 'sim-cel-inicial';
    tdInicial.style.cssText = 'padding:6px 0;text-align:center;font-weight:600;font-size:12px;';
    tdInicial.textContent = 'R$ 0,00';

    const tdEntrada = criarCelula('entrada', i, d.entrada);
    const tdSaida   = criarCelula('saida',   i, d.saida);

    const tdTotal = document.createElement('td');
    tdTotal.className = 'sim-cel-total';
    tdTotal.style.cssText = 'padding:6px 0;text-align:center;font-weight:700;font-size:12.5px;color:#1f7a1f;font-family:Outfit,Century Gothic,sans-serif;';
    tdTotal.textContent = 'R$ 0,00';

    tr.appendChild(tdMes);
    tr.appendChild(tdInicial);
    tr.appendChild(tdEntrada);
    tr.appendChild(tdSaida);
    tr.appendChild(tdTotal);
    tbody.appendChild(tr);
  });

  _recalcularSim();
}

function _iniciarTooltipThead() {
  // Cria elemento tooltip global se não existir
  let tip = document.getElementById('sim-thead-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'sim-thead-tooltip';
    document.body.appendChild(tip);
  }

  // Remove listeners antigos substituindo cada botão por uma cópia limpa
  // (evita acumular múltiplos listeners a cada vez que o simulador abre)
  document.querySelectorAll('.sim-thead-btn').forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
  });

  let _timer = null;
  document.querySelectorAll('.sim-thead-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const text = btn.dataset.simTooltip;
      const type = btn.dataset.simTooltipType;
      if (!text) return;

      // zoom CSS no <html> afeta getBoundingClientRect — precisa dividir para position:fixed
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

      // Captura posição do botão imediatamente
      const r = btn.getBoundingClientRect();

      // Aplica conteúdo e cor, mede com dimensões conhecidas do texto
      tip.textContent = text;
      tip.className = type;
      // Força render fora da tela para medir
      tip.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;visibility:visible;display:block;';
      void tip.offsetWidth;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      // Restaura estilos (transition e demais ficam no CSS)
      tip.style.cssText = '';
      tip.className = type;

      // Aplica posição corrigida pelo zoom
      const btnCenterX = (r.left + r.width / 2) / zoom;
      const btnTopY    = r.top / zoom;
      tip.style.left      = (btnCenterX - tw / 2) + 'px';
      tip.style.top       = (btnTopY - th - 10) + 'px';
      tip.style.transform = 'none';

      clearTimeout(_timer);
      _timer = setTimeout(() => tip.classList.add('show'), 400);
    });
    btn.addEventListener('mouseleave', () => {
      clearTimeout(_timer);
      tip.classList.remove('show');
    });
  });
}

function abrirSimuladorAnual() {
  const overlay = document.getElementById('popup-simulador-overlay');
  const popup   = document.getElementById('popup-simulador');
  overlay.style.display = 'block';
  popup.style.display   = 'block';
  requestAnimationFrame(() => {
    popup.style.opacity   = '1';
    popup.style.transform = 'translate(-50%,-50%) scale(1)';
    popup.style.pointerEvents = 'all';
  });
  _renderizarSimulador();
  _iniciarTooltipThead();
}

function fecharSimuladorAnual() {
  const overlay = document.getElementById('popup-simulador-overlay');
  const popup   = document.getElementById('popup-simulador');
  popup.style.opacity   = '0';
  popup.style.transform = 'translate(-50%,-50%) scale(0.94)';
  popup.style.pointerEvents = 'none';
  setTimeout(() => {
    popup.style.display   = 'none';
    overlay.style.display = 'none';
  }, 220);
}

function limparSimulador() {
  localStorage.removeItem(_chaveSimulador());
  _renderizarSimulador();
}
function replicarSimTodos(tipo) {
  const d2 = _carregarDadosSim();
  const primeiro = d2.find(m => m[tipo] > 0);
  if (!primeiro) return;
  const val = primeiro[tipo];
  d2.forEach(m => m[tipo] = val);
  _salvarDadosSim(d2);
  _renderizarSimulador();
}

function limparSimColuna(tipo) {
  const d2 = _carregarDadosSim();
  d2.forEach(m => m[tipo] = 0);
  _salvarDadosSim(d2);
  _renderizarSimulador();
}
/* ══ POPUP CONFIRMAR EXCLUIR META ══ */
function abrirPopupConfirmarExcluirMeta() {
  const overlay = document.getElementById('popup-excluir-meta-overlay');
  const popup   = document.getElementById('popup-excluir-meta');
  overlay.style.display = 'block';
  popup.style.display   = 'block';
  requestAnimationFrame(() => {
    popup.style.opacity     = '1';
    popup.style.transform   = 'translate(-50%,-50%) scale(1)';
    popup.style.pointerEvents = 'all';
  });
}

function fecharPopupConfirmarExcluirMeta() {
  const popup   = document.getElementById('popup-excluir-meta');
  const overlay = document.getElementById('popup-excluir-meta-overlay');
  popup.style.opacity     = '0';
  popup.style.transform   = 'translate(-50%,-50%) scale(0.94)';
  popup.style.pointerEvents = 'none';
  setTimeout(() => {
    popup.style.display   = 'none';
    overlay.style.display = 'none';
  }, 200);
}

function confirmarExcluirMeta() {
  fecharPopupConfirmarExcluirMeta();
  excluirMetaAtiva();
}
/* ── SPLASH SCREEN ── */
/* ── SPLASH PARTÍCULAS ── */
(function() {
  const canvas = document.getElementById("splash-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, particles, raf;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  function makeParticle() {
    return { x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.6+0.4,
             vx: (Math.random()-0.5)*0.3, vy: -(Math.random()*0.5+0.15), alpha: Math.random()*0.5+0.1 };
  }
  function init() { resize(); particles = Array.from({length:80}, makeParticle); }
  function draw() {
    ctx.clearRect(0,0,W,H);
    for (const p of particles) {
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(58,110,220,${p.alpha * 0.6})`; ctx.fill();
      p.x+=p.vx; p.y+=p.vy;
      if (p.y<-4) Object.assign(p, makeParticle(), {y:H+4});
    }
    raf = requestAnimationFrame(draw);
  }
  window.addEventListener("resize", resize);
  init(); draw();
  window._stopSplashCanvas = () => cancelAnimationFrame(raf);
})();

/* ── AUTH — lógica fictícia (front only) ── */

(function() {
  const titulo = document.querySelector('#login-panel .auth-titulo');
  if (titulo) {
    const temDados = localStorage.length > 0;
    titulo.textContent = temDados ? 'Bem-vindo de volta!' : 'Bem-vindo!';
  }
})();

function _authMostrarPainel(id) {
  ['login-panel','cadastro-panel','recuperar-panel','perfil-renda-panel'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) {
    target.style.display = 'flex';
    target.classList.remove('auth-panel-entering');
    void target.offsetWidth;
    target.classList.add('auth-panel-entering');
  }
}

function mostrarLogin()          { _authMostrarPainel('login-panel'); }
function mostrarCadastro()       { _authMostrarPainel('cadastro-panel'); }
function mostrarRecuperarSenha() { _authMostrarPainel('recuperar-panel'); }

/* ── PERFIL DE RENDA (duas entradas vs entrada única) ──
 *  Chave: 'planova_perfil_renda' → 'duas' | 'unica'
 *  Definido uma única vez, no primeiro acesso (pós-cadastro,
 *  ou no login se por algum motivo ainda não tiver sido definido).
 *  Não há fluxo de troca posterior — é definitivo. ── */
function _perfilRendaDefinido() {
  return !!localStorage.getItem('planova_perfil_renda');
}

function _perfilRendaSelecionar(perfil) {
  localStorage.setItem('planova_perfil_renda', perfil);
  _aplicarPerfilRenda();
  fecharSplash();
}

function mostrarEscolhaPerfilRenda() {
  _authMostrarPainel('perfil-renda-panel');
}

function _entrarComGoogle() {
  if (!_perfilRendaDefinido()) {
    mostrarEscolhaPerfilRenda();
    return;
  }
  fecharSplash();
}

function toggleSenhaVisivel(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const visivel = input.type === 'text';
  input.type = visivel ? 'password' : 'text';
  btn.style.color = visivel ? 'rgba(160,185,230,0.4)' : 'rgba(160,185,230,0.9)';
}

function fazerLogin() {
  const email = (document.getElementById('login-email')?.value || '').trim();
  const senha = (document.getElementById('login-senha')?.value || '').trim();
  if (!email || !senha) {
    _authErro('login-panel', 'Preencha e-mail e senha para continuar.');
    return;
  }
  if (!_perfilRendaDefinido()) {
    mostrarEscolhaPerfilRenda();
    return;
  }
  fecharSplash();
}

function fazerCadastro() {
  const nome  = (document.getElementById('cad-nome')?.value  || '').trim();
  const email = (document.getElementById('cad-email')?.value || '').trim();
  const senha = (document.getElementById('cad-senha')?.value || '').trim();
  if (!nome || !email || !senha) {
    _authErro('cadastro-panel', 'Preencha todos os campos para criar sua conta.');
    return;
  }
  if (senha.length < 8) {
    _authErro('cadastro-panel', 'A senha deve ter pelo menos 8 caracteres.');
    return;
  }
  mostrarEscolhaPerfilRenda();
}

function enviarRecuperacao() {
  const email = (document.getElementById('rec-email')?.value || '').trim();
  if (!email) {
    _authErro('recuperar-panel', 'Informe seu e-mail para continuar.');
    return;
  }
  _authSucesso('recuperar-panel', 'Link enviado! Verifique sua caixa de entrada.');
  setTimeout(() => mostrarLogin(), 2800);
}

function _authErro(painelId, msg) {
  const painel = document.getElementById(painelId);
  if (!painel) return;
  let el = painel.querySelector('.auth-erro');
  if (!el) {
    el = document.createElement('div');
    el.className = 'auth-erro';
    painel.insertBefore(el, painel.querySelector('.auth-btn-primary'));
  }
  el.textContent = msg;
  el.classList.add('visivel');
  setTimeout(() => el.classList.remove('visivel'), 3500);
}

function _authSucesso(painelId, msg) {
  const painel = document.getElementById(painelId);
  if (!painel) return;
  let el = painel.querySelector('.auth-sucesso');
  if (!el) {
    el = document.createElement('div');
    el.className = 'auth-sucesso';
    painel.insertBefore(el, painel.querySelector('.auth-btn-primary'));
  }
  el.textContent = msg;
  el.classList.add('visivel');
}

function fecharSplash() {
  const splash = document.getElementById("splash-screen");
  splash.classList.add("saindo");
  if (window._stopSplashCanvas) window._stopSplashCanvas();
  setTimeout(() => { splash.style.display = "none"; }, 600);
}
/* ── TOUR GUIADO ── */

// Snapshot dos dados reais do usuário — restaurado ao sair do tour
let _tourSnapshot = null;

function _tirarSnapshot() {
  _tourSnapshot = {
    campos: {},
    selects: {},
  };
  // Salva todos os inputs de valor
  document.querySelectorAll('input[type="number"], input[type="text"]').forEach(el => {
    if (el.id) _tourSnapshot.campos[el.id] = el.value;
  });
  // Salva todos os selects customizados
  document.querySelectorAll('select').forEach(sel => {
    if (sel.id) _tourSnapshot.selects[sel.id] = sel.value;
  });
}

function _restaurarSnapshot() {
  if (!_tourSnapshot) return;
  // Restaura inputs
  Object.entries(_tourSnapshot.campos).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
  });
  // Restaura selects e displays customizados
  Object.entries(_tourSnapshot.selects).forEach(([id, val]) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.value = val;
    const display = sel._customDisplay;
    if (display) {
      const clearBtn = display._clearBtn;
      display.textContent = val || '';
      if (clearBtn) display.appendChild(clearBtn);
      if (typeof aplicarCorBancoDisplay === 'function') aplicarCorBancoDisplay(display, val);
      if (clearBtn) {
        if (val) clearBtn.classList.add('visible');
        else clearBtn.classList.remove('visible');
      }
    }
  });
  recalc();
  _tourSnapshot = null;
}

// Timers pendentes do tour — limpos ao sair ou avançar passo
let _tourTimers = [];
function _clearTourTimers() {
  _tourTimers.forEach(t => clearTimeout(t));
  _tourTimers = [];
}
function _tourTimeout(fn, ms) {
  const t = setTimeout(fn, ms);
  _tourTimers.push(t);
  return t;
}

// Cria um dropdown FALSO sobre o display real — não toca em nada do estado real
function _tourSimularDropdown(blocoId, itens) {
  _tourRemoverSimulacao(); // limpa anterior se houver

  const bloco = document.getElementById(blocoId);
  if (!bloco) return;
  const display = bloco.querySelector('.select-banco-display');
  if (!display) return;

  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const rect = display.getBoundingClientRect();

  // Overlay falso sobre o display real (dá highlight sem tocar nele)
  const fakeDisplay = document.createElement('div');
  fakeDisplay.id = '_tour-fake-display';
  fakeDisplay.style.cssText = `
    position: fixed;
    top: ${rect.top / z}px;
    left: ${rect.left / z}px;
    width: ${rect.width / z}px;
    height: ${rect.height / z}px;
    border-radius: 6px;
    border: 2px solid #3a6edc;
    box-shadow: 0 0 0 3px rgba(58,110,220,0.18);
    pointer-events: none;
    z-index: 100001;
    box-sizing: border-box;
    transition: box-shadow 0.2s, border-color 0.2s;
  `;
  document.body.appendChild(fakeDisplay);

  // Dropdown falso
  const fakeList = document.createElement('div');
  fakeList.id = '_tour-fake-list';
  fakeList.style.cssText = `
    position: fixed;
    top: ${(rect.bottom / z) + 2}px;
    left: ${rect.left / z}px;
    min-width: ${Math.max(rect.width / z, 180)}px;
    background: #fff;
    border: 1px solid rgba(58,110,220,0.35);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(28,63,145,0.13);
    z-index: 100001;
    overflow: hidden;
    pointer-events: none;
    opacity: 0;
    transform: translateY(-6px) scale(0.97);
    transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.34,1.15,0.64,1);
    max-height: 220px;
    overflow-y: auto;
  `;

  itens.forEach(nome => {
    const item = document.createElement('div');
    item.textContent = nome;
    item.className = '_tour-fake-item';
    item.style.cssText = `
      padding: 5px 10px;
      font-size: 11px;
      font-family: inherit;
      color: #1a2a5e;
      white-space: nowrap;
      background: #fff;
    `;
    fakeList.appendChild(item);
  });
  document.body.appendChild(fakeList);

  // Anima entrada
  _tourTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fakeList.style.opacity = '1';
      fakeList.style.transform = 'translateY(0) scale(1)';
    }));
  }, 300);

  // Percorre itens em ordem
  const fakeItems = fakeList.querySelectorAll('._tour-fake-item');
  fakeItems.forEach((item, idx) => {
    _tourTimeout(() => {
      fakeItems.forEach(el => el.style.background = '#fff');
      item.style.background = '#dce8fb';
      item.style.color = '#1c3f91';
      item.style.fontWeight = '600';
    }, 500 + idx * 300);
    // Reset cor do item anterior
    if (idx > 0) {
      _tourTimeout(() => {
        fakeItems[idx - 1].style.background = '#fff';
        fakeItems[idx - 1].style.fontWeight = '';
        fakeItems[idx - 1].style.color = '#1a2a5e';
      }, 500 + idx * 300);
    }
  });
}

function _tourRemoverSimulacao() {
  ['_tour-fake-display', '_tour-fake-list', '_tour-fake-selected'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

// Variante que percorre itens e termina "selecionando" um deles visualmente no fake display
function _tourSimularDropdownComSelecao(blocoId, itens, itemSelecionado) {
  _tourRemoverSimulacao();

  const bloco = document.getElementById(blocoId);
  if (!bloco) return;
  const display = bloco.querySelector('.select-banco-display');
  if (!display) return;

  const z    = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const rect = display.getBoundingClientRect();

  // Borda de foco falsa
  const fakeDisplay = document.createElement('div');
  fakeDisplay.id = '_tour-fake-display';
  fakeDisplay.style.cssText = [
    'position:fixed',
    `top:${rect.top/z}px`, `left:${rect.left/z}px`,
    `width:${rect.width/z}px`, `height:${rect.height/z}px`,
    'border-radius:6px', 'border:2px solid #3a6edc',
    'box-shadow:0 0 0 3px rgba(58,110,220,0.18)',
    'pointer-events:none', 'z-index:100001', 'box-sizing:border-box',
  ].join(';');
  document.body.appendChild(fakeDisplay);

  // Dropdown falso
  const fakeList = document.createElement('div');
  fakeList.id = '_tour-fake-list';
  fakeList.style.cssText = [
    'position:fixed',
    `top:${(rect.bottom/z)+2}px`, `left:${rect.left/z}px`,
    `min-width:${Math.max(rect.width/z, 180)}px`,
    'background:#fff', 'border:1px solid rgba(58,110,220,0.35)',
    'border-radius:8px', 'box-shadow:0 6px 20px rgba(28,63,145,0.13)',
    'z-index:100001', 'overflow:hidden', 'pointer-events:none',
    'opacity:0', 'transform:translateY(-6px) scale(0.97)',
    'transition:opacity 0.3s ease,transform 0.3s cubic-bezier(0.34,1.15,0.64,1)',
    'max-height:220px', 'overflow-y:auto',
  ].join(';');

  const filtrados = itens.filter(n => n && n !== 'Selecione');
  filtrados.forEach(nome => {
    const item = document.createElement('div');
    item.dataset.nome = nome;
    item.textContent  = nome;
    item.style.cssText = 'padding:5px 10px;font-size:11px;font-family:inherit;color:#1a2a5e;white-space:nowrap;background:#fff;transition:background 0.1s';
    fakeList.appendChild(item);
  });
  document.body.appendChild(fakeList);

  // Anima entrada do dropdown
  _tourTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fakeList.style.opacity  = '1';
      fakeList.style.transform = 'translateY(0) scale(1)';
    }));
  }, 300);

  const fakeItems = [...fakeList.querySelectorAll('div')];
  const idxFinal  = fakeItems.findIndex(el => el.dataset.nome === itemSelecionado);
  const percorrer = idxFinal >= 0 ? fakeItems.slice(0, idxFinal + 1) : fakeItems;

  // Percorre até o item alvo
  percorrer.forEach((item, idx) => {
    _tourTimeout(() => {
      fakeItems.forEach(el => { el.style.background = '#fff'; el.style.fontWeight = ''; el.style.color = '#1a2a5e'; });
      item.style.background = '#dce8fb';
      item.style.color      = '#1c3f91';
      item.style.fontWeight = '600';
    }, 500 + idx * 280);
  });

  // Fecha dropdown e mostra item "selecionado" no fake display
  const totalDelay = 500 + percorrer.length * 280 + 200;
  _tourTimeout(() => {
    // Fecha com fade
    fakeList.style.transition = 'opacity 0.2s ease';
    fakeList.style.opacity    = '0';
    _tourTimeout(() => {
      fakeList.remove();
      // Atualiza fake display para mostrar o item selecionado
      fakeDisplay.style.border      = '1px solid #ccc';
      fakeDisplay.style.boxShadow   = 'none';
      fakeDisplay.style.background  = '#fff';
      fakeDisplay.style.display     = 'flex';
      fakeDisplay.style.alignItems  = 'center';
      fakeDisplay.style.paddingLeft = '8px';
      fakeDisplay.style.fontSize    = '11px';
      fakeDisplay.style.fontFamily  = 'inherit';
      fakeDisplay.style.color       = '#222';
      // Aplica cor do banco se disponível
      const corBanco = typeof coresBancos !== 'undefined' && coresBancos[itemSelecionado];
      if (corBanco) {
        fakeDisplay.style.background = corBanco.bg;
        fakeDisplay.style.color      = corBanco.color;
        fakeDisplay.style.fontWeight = '700';
      }
      fakeDisplay.textContent = itemSelecionado;
    }, 220);
  }, totalDelay);
}


const _tourPassos = [

  // ── 0. INTRODUÇÃO MENSAL ──
  {
    alvo: 'btn-dados',
    titulo: 'Página Mensal',
    desc: 'Este é seu painel de planejamento. Antes do mês começar, você informa seu salário e já prevê todos os gastos fixos — aluguel, cartões, contas. O sistema calcula automaticamente quanto vai sobrar, te dando uma visão clara do mês antes mesmo de ele acontecer.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg = document.getElementById('tour-overlay');
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();
      _tourTimeout(function() {
        const balao = document.getElementById('tour-balao');
        if (balao) {
          const z = _getCssZoom();
          balao.style.left = (window.innerWidth / z / 2 - balao.offsetWidth / 2) + 'px';
          balao.style.top  = (window.innerHeight / z / 2 - balao.offsetHeight / 2) + 'px';
        }
        _mostrarBalao();
      }, 160);
    },
    onSair: function() { _clearTourTimers(); }
  },

  // ── 1. BOTÃO DE DADOS ──
  {
    alvo: 'btn-dados',
    titulo: 'Seus dados ficam aqui',
    desc: 'Este botão abre o menu de backup. Seus dados ficam salvos somente neste navegador, então é importante baixar e guardar o arquivo de backup sempre que limpar o cache, usar outro navegador ou trocar de computador.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const btn = document.getElementById('btn-dados');
      if (!btn) { _mostrarBalao(); return; }

      _tourTimeout(function() {
        const z = _getCssZoom();
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { _mostrarBalao(); return; }

        const pad = 10;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const hole = document.createElementNS(ns, 'ellipse');
        hole.setAttribute('cx', x + w/2); hole.setAttribute('cy', y + h/2);
        hole.setAttribute('rx', w/2);     hole.setAttribute('ry', h/2);
        hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'ellipse');
        border.setAttribute('cx', x + w/2); border.setAttribute('cy', y + h/2);
        border.setAttribute('rx', w/2 + 2); border.setAttribute('ry', h/2 + 2);
        border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        btn.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.35s';
        btn.style.transform  = 'scale(1.18)';
        btn.style.boxShadow  = '0 0 0 6px rgba(58,110,220,0.18)';
        _tourTimeout(function() {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '';
        }, 420);

        _posicionarBalao([btn]);
      }, 200);
    },
    onSair: function() {
      _clearTourTimers();
      const btn = document.getElementById('btn-dados');
      if (btn) { btn.style.transition = ''; btn.style.transform = ''; btn.style.boxShadow = ''; }
    }
  },

  // ── 2. EXPORTAR DADOS ──
  {
    alvo: 'btn-dados',
    titulo: 'Exportar dados',
    desc: 'Clique em “Exportar dados” para baixar um arquivo com todo o seu histórico. Guarde esse arquivo em um lugar seguro, pois ele serve como backup e permite recuperar suas informações caso você troque de navegador, limpe o cache ou use outro dispositivo.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      _abrirDadosMenuTour();

      _tourTimeout(function() {
        const btn = document.getElementById('btn-exportar-dados');
        if (!btn) { _mostrarBalao(); return; }

        const z = _getCssZoom();
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { _mostrarBalao(); return; }

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const pad = 6;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x); hole.setAttribute('y', y);
        hole.setAttribute('width', w); hole.setAttribute('height', h);
        hole.setAttribute('rx', '9');
        hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y);
        border.setAttribute('width', w); border.setAttribute('height', h);
        border.setAttribute('rx', '9');
        border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        btn.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.35s';
        btn.style.transform  = 'scale(1.04)';
        btn.style.boxShadow  = '0 0 0 4px rgba(58,110,220,0.18)';
        _tourTimeout(function() {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '';
        }, 420);

        _posicionarBalao([btn]);
      }, 200);
    },
    onSair: function() {
      _clearTourTimers();
      const btn = document.getElementById('btn-exportar-dados');
      if (btn) { btn.style.transition = ''; btn.style.transform = ''; btn.style.boxShadow = ''; }
    }
  },

  // ── 3. IMPORTAR DADOS ──
  {
    alvo: 'btn-dados',
    titulo: 'Importar dados',
    desc: 'Se você já possui um arquivo de backup salvo anteriormente, use “Importar dados” para recuperar todo o seu histórico. Atenção: os dados atuais serão substituídos pelas informações do arquivo importado.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      _abrirDadosMenuTour();

      _tourTimeout(function() {
        const btn = document.getElementById('btn-importar-dados');
        if (!btn) { _mostrarBalao(); return; }

        const z = _getCssZoom();
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { _mostrarBalao(); return; }

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const pad = 6;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x); hole.setAttribute('y', y);
        hole.setAttribute('width', w); hole.setAttribute('height', h);
        hole.setAttribute('rx', '9');
        hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y);
        border.setAttribute('width', w); border.setAttribute('height', h);
        border.setAttribute('rx', '9');
        border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        btn.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.35s';
        btn.style.transform  = 'scale(1.04)';
        btn.style.boxShadow  = '0 0 0 4px rgba(58,110,220,0.18)';
        _tourTimeout(function() {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '';
        }, 420);

        _posicionarBalao([btn]);
      }, 200);
    },
    onSair: function() {
      _clearTourTimers();
      fecharDadosMenu();
      const btn = document.getElementById('btn-importar-dados');
      if (btn) { btn.style.transition = ''; btn.style.transform = ''; btn.style.boxShadow = ''; }
    }
  },

  // ── 4. SALÁRIO 1 ──
  {
    alvo: 'sal1',
    titulo: 'Salário — 1ª parcela',
    desc: 'Digite o valor do primeiro salário ou da principal fonte de renda do mês. Essa opção é ideal para quem recebe adiantamento salarial ou para casais que recebem em datas diferentes, incluindo situações em que ambos recebem adiantamentos.',
    padT: 6, padR: 2, padB: 6, padL: 6
  },

  // ── 2. ENTER SAL1 ──
  {
    alvo: 'sal1-enter',
    titulo: 'Confirmar o salário',
    desc: 'Aperte Enter ou clique em ↵ para registrar a entrada do valor.',
  },

  // ── 3. SALÁRIO 2 ──
  {
    alvo: 'sal2',
    titulo: 'Salário — 2ª parcela',
    desc: 'Digite o valor do primeiro salário ou da principal fonte de renda do mês. Essa opção é ideal para quem recebe adiantamento salarial ou para casais que recebem em datas diferentes, incluindo situações em que ambos recebem adiantamentos.',
    padT: 6, padR: 2, padB: 6, padL: 6
  },

  // ── 4. ENTER SAL2 ──
  {
    alvo: 'sal2-enter',
    titulo: 'Confirmar o 2º salário',
    desc: 'Aperte Enter ou clique em ↵ para registrar a entrada do valor.',
  },

  // ── 5. TOTAL DA RENDA ──
  {
    alvo: 'sal-total',
    titulo: 'Total da renda',
    desc: 'Este campo é preenchido automaticamente com a soma dos dois valores informados ao lado. Ele não pode ser editado e serve apenas para visualizar sua renda total do mês.',
  },

  // ── 7. RESIDÊNCIA ──
  {
    alvos: ['bloco1-res', 'bloco2-res'],
    titulo: 'Residência',
    desc: 'Informe aqui os gastos fixos da casa, como aluguel, financiamento, condomínio, água, luz e outras despesas mensais. Para selecionar a categoria, clique no campo e escolha uma das opções disponíveis ao lado.',
    onEntrar: function() {
      _tourSimularDropdown('bloco1-res', bancosResidencia);
    },
    onSair: function() {
      _clearTourTimers();
      _tourRemoverSimulacao();
    }
  },

  // ── 7. CARTÕES ──
  {
    alvos: ['bloco1-cart', 'bloco2-cart'],
    separados: true,
    titulo: 'Cartões',
    desc: 'Cada linha representa um cartão de crédito diferente. Ao selecionar o banco, a cor oficial do cartão é aplicada automaticamente, facilitando a identificação de cada fatura.',
    onEntrar: function() {
      _tourSimularDropdownComSelecao('bloco1-cart', bancosCartao, 'Itaú');
    },
    onSair: function() {
      _clearTourTimers();
      _tourRemoverSimulacao();
    }
  },

  // ── 8. OUTROS ──
  {
    alvos: ['bloco1-emp', 'bloco2-emp'],
    titulo: 'Outros',
    desc: 'Use esta seção para despesas que não se encaixam nas outras categorias, como empréstimos.',
  },

  // ── 9. SUBCATEGORIAS ──
  {
    alvo: 'bloco1-res',
    titulo: 'Subcategorias',
    desc: 'O ícone de etiqueta 🏷️ em cada linha permite adicionar uma subcategoria para detalhar melhor suas despesas. Por exemplo: em vez de apenas “Financiamento”, você pode identificar como “Moto”.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const btn1 = document.querySelector('#bloco1-res .btn-subcategoria-linha');
      const btn2 = document.querySelector('#bloco2-res .btn-subcategoria-linha');
      if (!btn1 || !btn2) { _mostrarBalao(); return; }

      _tourTimeout(() => {
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        [btn1, btn2].forEach(function(btn) {
          const r   = btn.getBoundingClientRect();
          const pad = 8;
          const x = r.left / z - pad, y = r.top / z - pad;
          const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

          const hole = document.createElementNS(ns, 'rect');
          hole.setAttribute('x', x); hole.setAttribute('y', y);
          hole.setAttribute('width', w); hole.setAttribute('height', h);
          hole.setAttribute('rx', 8); hole.setAttribute('fill', 'black');
          hole.classList.add('tour-dyn');
          mask.appendChild(hole);

          const border = document.createElementNS(ns, 'rect');
          border.setAttribute('x', x); border.setAttribute('y', y);
          border.setAttribute('width', w); border.setAttribute('height', h);
          border.setAttribute('rx', 8); border.setAttribute('fill', 'none');
          border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
          border.setAttribute('stroke-width', '2.5');
          border.classList.add('tour-dyn');
          svg.appendChild(border);
        });

        _posicionarBalao([btn1, btn2]);
      }, 300);
    },
    onSair: function() { _clearTourTimers(); }
  },

  // ── 10. REPLICAR LINHA ──
  {
    alvo: 'bloco1-res',
    titulo: 'Replicar lançamento',
    desc: 'O botão ⟳ ao lado de cada linha copia aquele gasto para os próximos meses — perfeito para despesas que se repetem. Você escolhe até qual mês replicar antes de confirmar.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const btn1 = document.querySelector('#bloco1-res .btn-replicar-linha');
      const btn2 = document.querySelector('#bloco2-res .btn-replicar-linha');
      if (!btn1 || !btn2) { _mostrarBalao(); return; }

      _tourTimeout(() => {
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        [btn1, btn2].forEach(function(btn) {
          const r   = btn.getBoundingClientRect();
          const pad = 9;
          const x = r.left / z - pad, y = r.top / z - pad;
          const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

          const hole = document.createElementNS(ns, 'ellipse');
          hole.setAttribute('cx', x + w/2); hole.setAttribute('cy', y + h/2);
          hole.setAttribute('rx', w/2);     hole.setAttribute('ry', h/2);
          hole.setAttribute('fill', 'black');
          hole.classList.add('tour-dyn');
          mask.appendChild(hole);

          const border = document.createElementNS(ns, 'ellipse');
          border.setAttribute('cx', x + w/2); border.setAttribute('cy', y + h/2);
          border.setAttribute('rx', w/2 + 2); border.setAttribute('ry', h/2 + 2);
          border.setAttribute('fill', 'none');
          border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
          border.setAttribute('stroke-width', '2.5');
          border.classList.add('tour-dyn');
          svg.appendChild(border);

          btn.style.transition = 'transform 0.5s ease';
          btn.style.transform  = 'rotate(360deg) scale(1.2)';
          _tourTimeout(() => { btn.style.transform = 'rotate(0deg) scale(1)'; }, 550);
        });

        _posicionarBalao([btn1, btn2]);
      }, 300);
    },
    onSair: function() {
      _clearTourTimers();
      ['#bloco1-res .btn-replicar-linha', '#bloco2-res .btn-replicar-linha'].forEach(function(sel) {
        const btn = document.querySelector(sel);
        if (btn) { btn.style.transition = ''; btn.style.transform = ''; }
      });
    }
  },

  // ── 11. LIMPAR LINHA ──
  {
    alvo: 'bloco1-res',
    titulo: 'Limpar linha',
    desc: 'O botão × apaga os dados daquela linha — categoria, valor e subcategoria — sem remover a linha em si.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const btn1 = document.querySelector('#bloco1-res .btn-limpar-linha');
      const btn2 = document.querySelector('#bloco2-res .btn-limpar-linha');
      if (!btn1 || !btn2) { _mostrarBalao(); return; }

      _tourTimeout(() => {
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        [btn1, btn2].forEach(function(btn) {
          const r   = btn.getBoundingClientRect();
          const pad = 9;
          const x = r.left / z - pad, y = r.top / z - pad;
          const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

          const hole = document.createElementNS(ns, 'ellipse');
          hole.setAttribute('cx', x + w/2); hole.setAttribute('cy', y + h/2);
          hole.setAttribute('rx', w/2);     hole.setAttribute('ry', h/2);
          hole.setAttribute('fill', 'black');
          hole.classList.add('tour-dyn');
          mask.appendChild(hole);

          const border = document.createElementNS(ns, 'ellipse');
          border.setAttribute('cx', x + w/2); border.setAttribute('cy', y + h/2);
          border.setAttribute('rx', w/2 + 2); border.setAttribute('ry', h/2 + 2);
          border.setAttribute('fill', 'none');
          border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
          border.setAttribute('stroke-width', '2.5');
          border.classList.add('tour-dyn');
          svg.appendChild(border);

          // Shake
          btn.style.transition = 'transform 0.1s ease';
          var count = 0;
          var shake = function() {
            if (count >= 4) { btn.style.transform = 'scale(1)'; return; }
            btn.style.transform = count % 2 === 0 ? 'translateX(-3px) scale(1.15)' : 'translateX(3px) scale(1.15)';
            count++;
            _tourTimeout(shake, 100);
          };
          _tourTimeout(shake, 100);
        });

        _posicionarBalao([btn1, btn2]);
      }, 300);
    },
    onSair: function() {
      _clearTourTimers();
      ['#bloco1-res .btn-limpar-linha', '#bloco2-res .btn-limpar-linha'].forEach(function(sel) {
        const btn = document.querySelector(sel);
        if (btn) { btn.style.transition = ''; btn.style.transform = ''; }
      });
    }
  },

  // ── 12. GAVETA (total por seção) ──
  {
    alvo: 'wrap-tot1-res',
    titulo: 'Total por seção',
    desc: 'Cada seção tem uma gaveta com o total acumulado. Ela desliza para fora ao deixar o mouse em cima do título — útil para conferir rapidamente quanto foi gasto em cada categoria.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      _tourTimeout(function() {
        toggleBlocoValor('tot1-res');
        _tourTimeout(function() {
          toggleBlocoValor('tot2-res');
          _tourTimeout(function() {
            const ns = 'http://www.w3.org/2000/svg';
            const z  = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
            svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

            ['gav-tot1-res', 'gav-tot2-res'].forEach(function(id) {
              const el = document.getElementById(id);
              if (!el) return;
              const r   = el.getBoundingClientRect();
              const pad = 6;
              const x = r.left / z - pad, y = r.top / z - pad;
              const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

              const hole = document.createElementNS(ns, 'rect');
              hole.setAttribute('x', x); hole.setAttribute('y', y);
              hole.setAttribute('width', w); hole.setAttribute('height', h);
              hole.setAttribute('rx', 8); hole.setAttribute('fill', 'black');
              hole.classList.add('tour-dyn');
              mask.appendChild(hole);

              const border = document.createElementNS(ns, 'rect');
              border.setAttribute('x', x); border.setAttribute('y', y);
              border.setAttribute('width', w); border.setAttribute('height', h);
              border.setAttribute('rx', 8); border.setAttribute('fill', 'none');
              border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
              border.setAttribute('stroke-width', '2.5');
              border.classList.add('tour-dyn');
              svg.appendChild(border);
            });

            const gavEls = ['gav-tot1-res','gav-tot2-res'].map(function(id) {
              return document.getElementById(id);
            }).filter(Boolean);
            if (gavEls.length) _posicionarBalao(gavEls);
            else _mostrarBalao();

          }, 600);
        }, 500);
      }, 400);
    },
    onSair: function() {
      _clearTourTimers();
      ['tot1-res', 'tot2-res'].forEach(function(id) {
        const wrap = document.getElementById('wrap-' + id);
        if (wrap) wrap.classList.remove('aberto');
      });
    }
  },

  // ── 13. SUBTOTAL / BARRA PROGRESSIVA ──
  {
    alvos: ['sub1-wrap', 'sub2-wrap'],
    separados: true,
    circulo: true,
    titulo: 'Subtotais com barras progressivas',
    desc: 'O círculo mostra o total gasto em relação ao salário de cada bloco. A barra ao redor vai preenchendo conforme os gastos se aproximam do limite — uma forma visual de acompanhar seu orçamento em tempo real.',
    padT: 8, padR: 8, padB: 8, padL: 8,
    onEntrar: function() {
      const CIRC = 301.59;
      const pct = 0.72;
      const offset = (CIRC - pct * CIRC).toFixed(2);
      ['sub1-ring','sub2-ring'].forEach(function(id) {
        const r = document.getElementById(id);
        if (r) { r.style.transition = 'stroke-dashoffset 1s ease'; r.style.strokeDashoffset = offset; }
      });
    },
    onSair: function() {
      _clearTourTimers();
      ['sub1-ring','sub2-ring'].forEach(function(id) {
        const r = document.getElementById(id);
        if (r) { r.style.transition = 'stroke-dashoffset 0.4s ease'; r.style.strokeDashoffset = '301.59'; }
      });
    }
  },

  // ── 14. SALDO LIVRE POR BLOCO ──
  {
    alvos: ['sub1-livre', 'sub2-livre'],
    separados: true,
    titulo: 'Saldo livre por bloco',
    desc: 'Mostra quanto ainda sobra em cada bloco depois de descontar todos os gastos e os valores enviados para a reserva ou metas. Verde significa que ainda há dinheiro disponível; vermelho indica que os compromissos ultrapassaram o salário daquele bloco.',
    padT: 6, padR: 10, padB: 6, padL: 10,
    onEntrar: function() {
      ['sub1-livre', 'sub2-livre'].forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.transition = 'box-shadow 0.4s ease';
        el.style.boxShadow  = '0 0 0 3px rgba(58,110,220,0.5)';
        _tourTimeout(function() { el.style.boxShadow = '0 0 0 0px rgba(58,110,220,0)'; }, 500);
      });
    },
    onSair: function() {
      _clearTourTimers();
      ['sub1-livre', 'sub2-livre'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) { el.style.transition = ''; el.style.boxShadow = ''; }
      });
    }
  },

  // ── 15. PREVISÃO DE SALDO ──
  {
    alvo: 'p-previsao',
    titulo: 'Previsão de Saldo',
    desc: 'Mostra quanto vai sobrar no final do mês: salário total menos todos os gastos lançados. O valor e a porcentagem ficam verdes quando sobra dinheiro e vermelhos quando os gastos ultrapassam a renda total.',
    padT: 28, padR: 20, padB: 28, padL: 20,
    onEntrar: function() {
      const el = document.getElementById('p-previsao');
      if (!el) return;
      el.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1)';
      el.style.transform  = 'scale(1.12)';
      _tourTimeout(function() { el.style.transform = 'scale(1)'; }, 400);
    },
    onSair: function() {
      _clearTourTimers();
      const el = document.getElementById('p-previsao');
      if (el) { el.style.transition = ''; el.style.transform = ''; }
    }
  },

  // ── 16. PREVISÃO DE GASTOS ──
  {
    alvo: 'p-total',
    titulo: 'Previsão de Gastos',
    desc: 'Soma de tudo que você lançou como gastos no mês — independente de já ter sido pago ou não. A porcentagem indica quanto da sua renda está comprometida com gastos, assim como em R$.',
    padT: 28, padR: 20, padB: 28, padL: 20,
    onEntrar: function() {
      const el = document.getElementById('p-total');
      if (!el) return;
      el.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1)';
      el.style.transform  = 'scale(1.12)';
      _tourTimeout(function() { el.style.transform = 'scale(1)'; }, 400);
    },
    onSair: function() {
      _clearTourTimers();
      const el = document.getElementById('p-total');
      if (el) { el.style.transition = ''; el.style.transform = ''; }
    }
  },

  // ── 17. RESERVA DE EMERGÊNCIA ──
  {
    alvo: 'res-saldo-display',
    titulo: 'Reserva de Emergência',
    desc: 'Aqui você pode reservar dinheiro para emergências e imprevistos. Adicione valores quando puder e utilize quando precisar. O saldo acumulado permanece salvo mês após mês, funcionando como uma reserva dentro do próprio app.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const saldoEl = document.getElementById('res-saldo-display');
      const cardEl  = saldoEl ? saldoEl.closest('.reserva-card') : null;
      if (!cardEl) { _mostrarBalao(); return; }

      _tourTimeout(function() {
        const z   = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const r   = cardEl.getBoundingClientRect();
        const pad = 8;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x); hole.setAttribute('y', y);
        hole.setAttribute('width', w); hole.setAttribute('height', h);
        hole.setAttribute('rx', 12); hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y);
        border.setAttribute('width', w); border.setAttribute('height', h);
        border.setAttribute('rx', 12); border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        const btns = cardEl.querySelectorAll('.reserva-card-btn');
        btns.forEach(function(btn, i) {
          _tourTimeout(function() {
            btn.style.transition = 'transform 0.3s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.3s';
            btn.style.transform  = 'scale(1.08)';
            btn.style.boxShadow  = '0 4px 14px rgba(28,63,145,0.22)';
            _tourTimeout(function() {
              btn.style.transform = 'scale(1)';
              btn.style.boxShadow = '';
            }, 350);
          }, 200 + i * 180);
        });

        _posicionarBalao([cardEl]);
      }, 300);
    },
    onSair: function() {
      _clearTourTimers();
      const saldoEl = document.getElementById('res-saldo-display');
      const cardEl  = saldoEl ? saldoEl.closest('.reserva-card') : null;
      if (cardEl) {
        cardEl.querySelectorAll('.reserva-card-btn').forEach(function(btn) {
          btn.style.transition = '';
          btn.style.transform  = '';
          btn.style.boxShadow  = '';
        });
      }
    }
  },

  // ── 18. SIMULAR RESERVA ──
  {
    alvo: 'btn-simular-reserva',
    titulo: 'Simulador de Reserva',
    desc: 'O botão "Simular" abre uma projeção anual da sua reserva — mostra mês a mês quanto você teria acumulado com base nos depósitos e retiradas planejados. Ideal para visualizar o crescimento ao longo do tempo.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const btn = document.getElementById('btn-simular-reserva');
      if (!btn) { _mostrarBalao(); return; }

      _tourTimeout(function() {
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { _mostrarBalao(); return; }

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        // Card da reserva iluminado ao fundo para manter contexto
        const saldoEl = document.getElementById('res-saldo-display');
        const cardEl  = saldoEl ? saldoEl.closest('.reserva-card') : null;
        if (cardEl) {
          const rc   = cardEl.getBoundingClientRect();
          const pad2 = 8;
          const cx = rc.left / z - pad2, cy = rc.top / z - pad2;
          const cw = rc.width / z + pad2 * 2, ch = rc.height / z + pad2 * 2;

          const holeCard = document.createElementNS(ns, 'rect');
          holeCard.setAttribute('x', cx); holeCard.setAttribute('y', cy);
          holeCard.setAttribute('width', cw); holeCard.setAttribute('height', ch);
          holeCard.setAttribute('rx', 12); holeCard.setAttribute('fill', 'black');
          holeCard.classList.add('tour-dyn');
          mask.appendChild(holeCard);

          const borderCard = document.createElementNS(ns, 'rect');
          borderCard.setAttribute('x', cx); borderCard.setAttribute('y', cy);
          borderCard.setAttribute('width', cw); borderCard.setAttribute('height', ch);
          borderCard.setAttribute('rx', 12); borderCard.setAttribute('fill', 'none');
          borderCard.setAttribute('stroke', 'rgba(58,110,220,0.30)');
          borderCard.setAttribute('stroke-width', '2');
          borderCard.classList.add('tour-dyn');
          svg.appendChild(borderCard);
        }

        // Destaque forte no botão Simular
        const pad = 8;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x); hole.setAttribute('y', y);
        hole.setAttribute('width', w); hole.setAttribute('height', h);
        hole.setAttribute('rx', 6); hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y);
        border.setAttribute('width', w); border.setAttribute('height', h);
        border.setAttribute('rx', 6); border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        // Pulso de atenção no botão
        btn.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.35s';
        btn.style.transform  = 'scale(1.14)';
        btn.style.boxShadow  = '0 0 0 5px rgba(58,110,220,0.18)';
        _tourTimeout(function() {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '';
        }, 420);

        _posicionarBalao([btn]);
      }, 200);
    },
    onSair: function() {
      _clearTourTimers();
      const btn = document.getElementById('btn-simular-reserva');
      if (btn) { btn.style.transition = ''; btn.style.transform = ''; btn.style.boxShadow = ''; }
    }
  },

  // ── 19. METAS FINANCEIRAS ──
  {
    alvo: 'meta-card-principal',
    titulo: 'Metas financeiras',
    desc: 'Cadastre objetivos com nome, valor que deseja alcançar e prazo — como uma viagem ou para um veículo ou apartamento. O card mostra o progresso em tempo real com barra de preenchimento e prazo estimado. Limite de 3 cards ao mesmo tempo.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const ativo  = document.getElementById('res-ativo-state');
      const vazio  = document.getElementById('res-vazio-state');
      const alvoEl = (ativo && ativo.style.display !== 'none')
        ? document.getElementById('meta-card-principal')
        : vazio;
      if (!alvoEl) { _mostrarBalao(); return; }

      _tourTimeout(function() {
        const z   = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const r   = alvoEl.getBoundingClientRect();
        const pad = 10;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x); hole.setAttribute('y', y);
        hole.setAttribute('width', w); hole.setAttribute('height', h);
        hole.setAttribute('rx', 12); hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y);
        border.setAttribute('width', w); border.setAttribute('height', h);
        border.setAttribute('rx', 12); border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        _posicionarBalao([alvoEl]);
      }, 300);
    },
    onSair: function() { _clearTourTimers(); }
  },

  // ── 26. REPLICAR MÊS ──
  {
    alvo: 'view-mes-container',
    titulo: 'Replicar gastos do mês',
    desc: 'Copia todos os gastos do mês atual para o próximo.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      _tourTimeout(function() {
        // btn-replicar-mes só tem classe, não ID
        const btn = document.querySelector('.btn-replicar-mes');

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        if (!btn) { _mostrarBalao(); return; }

        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { _mostrarBalao(); return; }

        const pad = 10;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        const hole = document.createElementNS(ns, 'ellipse');
        hole.setAttribute('cx', x + w/2); hole.setAttribute('cy', y + h/2);
        hole.setAttribute('rx', w/2);     hole.setAttribute('ry', h/2);
        hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'ellipse');
        border.setAttribute('cx', x + w/2); border.setAttribute('cy', y + h/2);
        border.setAttribute('rx', w/2 + 2); border.setAttribute('ry', h/2 + 2);
        border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        btn.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1)';
        btn.style.transform  = 'scale(1.18)';
        btn.style.boxShadow  = '0 0 0 6px rgba(58,110,220,0.18)';
        _tourTimeout(function() {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '';
        }, 420);

        _posicionarBalao([btn]);
      }, 200);
    },
    onSair: function() {
      _clearTourTimers();
      const btn = document.querySelector('.btn-replicar-mes');
      if (btn) { btn.style.transition = ''; btn.style.transform = ''; btn.style.boxShadow = ''; }
    }
  },

  // ── 20. FECHAMENTO CONTÁBIL ──
  {
    alvo: 'btn-fechar-mes',
    titulo: 'Fechamento contábil',
    desc: 'Antes de iniciar um novo mês, é muito importante encerrar o mês atual. Sem esse fechamento, não é possível realizar depósitos ou saques em metas e na reserva de emergência. Após o fechamento, o mês fica bloqueado para edição, garantindo um histórico confiável e cálculos corretos.',
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const btn = document.getElementById('btn-fechar-mes');
      if (!btn) { _mostrarBalao(); return; }

      _tourTimeout(function() {
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { _mostrarBalao(); return; }

        const pad = 10;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const hole = document.createElementNS(ns, 'ellipse');
        hole.setAttribute('cx', x + w/2); hole.setAttribute('cy', y + h/2);
        hole.setAttribute('rx', w/2);     hole.setAttribute('ry', h/2);
        hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'ellipse');
        border.setAttribute('cx', x + w/2); border.setAttribute('cy', y + h/2);
        border.setAttribute('rx', w/2 + 2); border.setAttribute('ry', h/2 + 2);
        border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        btn.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.35s';
        btn.style.transform  = 'scale(1.18)';
        btn.style.boxShadow  = '0 0 0 6px rgba(58,110,220,0.18)';
        _tourTimeout(function() {
          btn.style.transform = 'scale(1)';
          btn.style.boxShadow = '';
        }, 420);

        _posicionarBalao([btn]);
      }, 200);
    },
    onSair: function() {
      _clearTourTimers();
      const btn = document.getElementById('btn-fechar-mes');
      if (btn) { btn.style.transition = ''; btn.style.transform = ''; btn.style.boxShadow = ''; }
    }
  },

  // ── 6. TROCAR ANO ──
  {
    alvo: 'ano-badge',
    titulo: 'Trocar o ano',
    desc: 'No canto superior direito fica o seletor de ano. Clique sobre ele para ver os anos disponíveis e alternar entre eles — cada ano tem seu próprio histórico mensal preservado.',
    padT: 8, padR: 8, padB: 8, padL: 8,
    _semHighlightInicial: true,
    onEntrar: function() {
      const svg  = document.getElementById('tour-overlay');
      const mask = svg.querySelector('#tour-mask');
      const ns   = 'http://www.w3.org/2000/svg';
      svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
      _esconderBalao();

      const badge = document.getElementById('ano-badge');
      if (!badge) { _mostrarBalao(); return; }

      _tourTimeout(function() {
        const z   = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const r   = badge.getBoundingClientRect();
        const pad = 8;
        const x = r.left / z - pad, y = r.top / z - pad;
        const w = r.width / z + pad * 2, h = r.height / z + pad * 2;

        svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

        const hole = document.createElementNS(ns, 'rect');
        hole.setAttribute('x', x); hole.setAttribute('y', y);
        hole.setAttribute('width', w); hole.setAttribute('height', h);
        hole.setAttribute('rx', 8); hole.setAttribute('fill', 'black');
        hole.classList.add('tour-dyn');
        mask.appendChild(hole);

        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y);
        border.setAttribute('width', w); border.setAttribute('height', h);
        border.setAttribute('rx', 8); border.setAttribute('fill', 'none');
        border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
        border.setAttribute('stroke-width', '2.5');
        border.classList.add('tour-dyn');
        svg.appendChild(border);

        // Simula abertura e fechamento do dropdown
        toggleAnoDropdown();
        _tourTimeout(function() {
          // Ilumina também o dropdown aberto
          const list = document.getElementById('ano-dropdown-list');
          if (list && list.style.display !== 'none') {
            const rl  = list.getBoundingClientRect();
            const padL = 4;
            const xl = rl.left / z - padL, yl = rl.top / z - padL;
            const wl = rl.width / z + padL * 2, hl = rl.height / z + padL * 2;

            const holeL = document.createElementNS(ns, 'rect');
            holeL.setAttribute('x', xl); holeL.setAttribute('y', yl);
            holeL.setAttribute('width', wl); holeL.setAttribute('height', hl);
            holeL.setAttribute('rx', 8); holeL.setAttribute('fill', 'black');
            holeL.classList.add('tour-dyn');
            mask.appendChild(holeL);

            const borderL = document.createElementNS(ns, 'rect');
            borderL.setAttribute('x', xl); borderL.setAttribute('y', yl);
            borderL.setAttribute('width', wl); borderL.setAttribute('height', hl);
            borderL.setAttribute('rx', 8); borderL.setAttribute('fill', 'none');
            borderL.setAttribute('stroke', 'rgba(58,110,220,0.85)');
            borderL.setAttribute('stroke-width', '2');
            borderL.classList.add('tour-dyn');
            svg.appendChild(borderL);
          }

          // Fecha após mostrar
          _tourTimeout(function() {
            const list2 = document.getElementById('ano-dropdown-list');
            if (list2 && list2.style.display !== 'none') toggleAnoDropdown();
          }, 1400);
        }, 200);

        // Animação no badge
        badge.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1)';
        badge.style.transform  = 'scale(1.12)';
        _tourTimeout(function() { badge.style.transform = 'scale(1)'; }, 420);

        _posicionarBalao([badge]);
      }, 300);
    },
    onSair: function() {
      _clearTourTimers();
      const badge = document.getElementById('ano-badge');
      if (badge) { badge.style.transition = ''; badge.style.transform = ''; }
      const list = document.getElementById('ano-dropdown-list');
      if (list && list.style.display !== 'none') toggleAnoDropdown();
    }
  },

];
let _tourAtual = 0;

function iniciarTour() {
  _tourAtual = 0;
  _tirarSnapshot();
  document.body.classList.add('tour-ativo');
  document.getElementById('tour-overlay').style.display = 'block';
  document.getElementById('tour-bloqueador').style.display = 'block';
  // Reassigna imediatamente os botões do balão para o tour mensal,
  // garantindo que não apontem para funções do tour do diário
  var _btnProxImm  = document.getElementById('tour-btn-prox');
  var _btnAntImm   = document.getElementById('tour-btn-ant');
  var _btnPularImm = document.getElementById('tour-btn-pular');
  if (_btnProxImm)  _btnProxImm.onclick  = tourProximo;
  if (_btnAntImm)   _btnAntImm.onclick   = tourAnterior;
  if (_btnPularImm) _btnPularImm.onclick  = tourPular;
  _tourMenuPopular();
  // Cria/move botão índice para o final do body garantindo que fique acima de tudo
  var btnExistente = document.getElementById('tour-btn-indice');
  if (btnExistente) btnExistente.remove();
  var btn = document.createElement('button');
  btn.id = 'tour-btn-indice';
  btn.innerHTML = '☰ Etapas do tour';
  btn.onclick = tourToggleIndice;
  btn.style.cssText = 'display:none;position:fixed;top:62px;left:18px;z-index:2147483647;background:#3a6edc;border:none;border-radius:12px;padding:12px 20px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;color:#fff;';
  btn.className = 'tour-btn-indice-float';
  document.body.appendChild(btn);
  // Menu só aparece após o primeiro "próximo"
  _tourMenuEsconder();
  _exibirPassoTour(_tourAtual);
}

function _tourMenuPopular() {
  const lista = document.getElementById('tour-indice-lista');
  if (!lista) return;
  lista.innerHTML = '';
  _tourPassos.forEach(function(passo, i) {
    const titulo = passo.titulo || ('Etapa ' + (i + 1));
    const item = document.createElement('button');
    item.id = 'tour-indice-item-' + i;
    item.textContent = (i + 1) + '. ' + titulo;
    item.className = 'tour-indice-item';
    item.style.cssText = [
      'display:block;width:100%;text-align:left;background:none;border:none;',
      'border-radius:8px;padding:8px 12px;font-size:12px;font-weight:500;',
      'color:rgba(255,255,255,0.75);cursor:pointer;font-family:inherit;',
      'transition:background 0.15s,color 0.15s;line-height:1.4;'
    ].join('');
    item.onmouseover = function() { if (!item.classList.contains('ativo')) { item.style.background='rgba(255,255,255,0.1)'; item.style.color='#fff'; } };
    item.onmouseout  = function() { if (!item.classList.contains('ativo')) { item.style.background='none'; item.style.color='rgba(255,255,255,0.75)'; } };
    item.onclick = function() { _tourIrPara(i); };
    lista.appendChild(item);
  });
}

function _tourMenuAtualizar(idx) {
  const lista = document.getElementById('tour-indice-lista');
  if (!lista) return;
  lista.querySelectorAll('button').forEach(function(btn, i) {
    const ativo = i === idx;
    btn.classList.toggle('ativo', ativo);
    btn.style.background = ativo ? 'rgba(255,255,255,0.18)' : 'none';
    btn.style.color      = ativo ? '#fff' : 'rgba(255,255,255,0.75)';
    btn.style.fontWeight = ativo ? '700' : '500';
    if (ativo) btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function _tourMenuMostrar() {
  const btn = document.getElementById('tour-btn-indice');
  if (btn) { btn.style.display = 'block'; }
}

function _tourMenuEsconder() {
  const btn = document.getElementById('tour-btn-indice');
  if (btn) btn.style.display = 'none';
  tourFecharIndice();
}

function tourToggleIndice() {
  const painel  = document.getElementById('tour-indice-painel');
  const overlay = document.getElementById('tour-indice-overlay');
  const btn     = document.getElementById('tour-btn-indice');
  if (!painel) return;
  const aberto = painel.style.transform === 'translateX(0%)';
  if (aberto) {
    tourFecharIndice();
  } else {
    _tourMenuAtualizar(_tourAtual);
    if (btn) btn.style.display = 'none';
    overlay.style.display = 'block';
    painel.style.display  = 'flex';
    requestAnimationFrame(function() {
      painel.style.transform = 'translateX(0%)';
      painel.style.opacity   = '1';
    });
  }
}

function tourFecharIndice() {
  const painel  = document.getElementById('tour-indice-painel');
  const overlay = document.getElementById('tour-indice-overlay');
  const btn     = document.getElementById('tour-btn-indice');
  if (!painel) return;
  painel.style.transform = 'translateX(-100%)';
  painel.style.opacity   = '0';
  setTimeout(function() { painel.style.display = 'none'; }, 230);
  if (overlay) overlay.style.display = 'none';
  if (btn && btn.style.display === 'none' && document.body.classList.contains('tour-ativo')) btn.style.display = 'block';
}

function _tourIrPara(idx) {
  tourFecharIndice();
  if (idx === _tourAtual) return;
  if (_tourPassos[_tourAtual] && _tourPassos[_tourAtual].onSair) _tourPassos[_tourAtual].onSair();
  _tourAtual = idx;
  _exibirPassoTour(_tourAtual);
}

function _getCssZoom() {
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

function _esconderBalao() {
  const b = document.getElementById('tour-balao');
  if (!b) return;
  b.style.opacity       = '0';
  b.style.transform     = 'translateY(8px)';
  b.style.pointerEvents = 'none';
}

function _mostrarBalao() {
  const b = document.getElementById('tour-balao');
  if (!b) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    b.style.opacity       = '1';
    b.style.transform     = 'translateY(0)';
    b.style.pointerEvents = 'auto';
  }));
}

// Posiciona o balão relativo a um ou mais elementos (ou elemento central)
function _posicionarBalaoEsquerdaDaColuna(els) {
  const balao = document.getElementById('tour-balao');
  if (!balao) return;
  const z    = _getCssZoom();
  const vW   = window.innerWidth  / z;
  const vH   = window.innerHeight / z;
  const bW   = 300;
  const bH   = balao.offsetHeight || 200;
  const marg = 14;

  if (!Array.isArray(els)) els = [els];
  const rects  = els.map(el => el.getBoundingClientRect());
  const ancTop    = Math.min(...rects.map(r => r.top))    / z;
  const ancBottom = Math.max(...rects.map(r => r.bottom)) / z;
  const ancLeft   = Math.min(...rects.map(r => r.left))   / z;
  const ancRight  = Math.max(...rects.map(r => r.right))  / z;
  const ancCy     = (ancTop + ancBottom) / 2;

  let bTop, bLeft;
  // Tenta posicionar à esquerda da coluna, centralizado verticalmente
  if (ancLeft >= bW + marg) {
    bLeft = ancLeft - bW - marg;
    bTop  = ancCy - bH / 2;
  } else if (vW - ancRight >= bW + marg) {
    // Fallback: à direita
    bLeft = ancRight + marg;
    bTop  = ancCy - bH / 2;
  } else {
    // Fallback: abaixo
    bTop  = ancBottom + marg;
    bLeft = (ancLeft + ancRight) / 2 - bW / 2;
  }

  bLeft = Math.max(16, Math.min(bLeft, vW - bW - 16));
  bTop  = Math.max(16, Math.min(bTop,  vH - bH - 16));
  balao.style.top  = bTop  + 'px';
  balao.style.left = bLeft + 'px';
  _mostrarBalao();
}

function _posicionarBalao(els) {
  const balao = document.getElementById('tour-balao');
  if (!balao) return;
  const z   = _getCssZoom();
  const vW  = window.innerWidth  / z;
  const vH  = window.innerHeight / z;
  const bW  = 300;
  const bH  = balao.offsetHeight || 200;
  const marg = 14;

  if (!Array.isArray(els)) els = [els];
  const rects = els.map(el => el.getBoundingClientRect());
  const ancTop    = Math.min(...rects.map(r => r.top))    / z;
  const ancBottom = Math.max(...rects.map(r => r.bottom)) / z;
  const ancLeft   = Math.min(...rects.map(r => r.left))   / z;
  const ancRight  = Math.max(...rects.map(r => r.right))  / z;
  const ancCx     = (ancLeft + ancRight) / 2;

  let bTop, bLeft;
  if (vH - ancBottom >= bH + marg) {
    bTop  = ancBottom + marg;
    bLeft = ancCx - bW / 2;
  } else if (ancTop >= bH + marg) {
    bTop  = ancTop - marg - bH;
    bLeft = ancCx - bW / 2;
  } else {
    bTop  = vH / 2 - bH / 2;
    bLeft = vW / 2 - bW / 2;
  }

  bLeft = Math.max(16, Math.min(bLeft, vW - bW - 16));
  bTop  = Math.max(16, Math.min(bTop,  vH - bH - 16));
  balao.style.top  = bTop  + 'px';
  balao.style.left = bLeft + 'px';
  _mostrarBalao();
}

function _getRectPadded(el, passo) {
  const r = el.getBoundingClientRect();
  const z = _getCssZoom();
  const padT = passo.padT !== undefined ? passo.padT : 6;
  const padR = passo.padR !== undefined ? passo.padR : 6;
  const padB = passo.padB !== undefined ? passo.padB : 6;
  const padL = passo.padL !== undefined ? passo.padL : 6;
  return {
    x:      r.left   / z - padL,
    y:      r.top    / z - padT,
    w:      r.width  / z + padL + padR,
    h:      r.height / z + padT + padB,
    right:  r.right  / z + padR,
    bottom: r.bottom / z + padB,
    cx:     r.left   / z + r.width  / z / 2,
    cy:     r.top    / z + r.height / z / 2,
  };
}

function _exibirPassoTour(i) {
  // 1. Cancela TODOS os timers pendentes
  _clearTourTimers();

  // 2. Remove simulação visual imediatamente
  _tourRemoverSimulacao();

  const passo = _tourPassos[i];

  // 3. Chama onSair do passo anterior (estado limpo)
  if (i > 0 && _tourPassos[i-1].onSair) _tourPassos[i-1].onSair();

  const viewMain = document.getElementById('view-main-layout');
  if (viewMain) viewMain.style.display = '';

  const ids = passo.alvos || [passo.alvo];
  const els = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!els.length) return;

  const svg = document.getElementById('tour-overlay');
  const ns = 'http://www.w3.org/2000/svg';
  const mask = svg.querySelector('#tour-mask');

  // ── Fase 1: fade-out suave do balão + limpa highlights imediatamente ──
  const balao = document.getElementById('tour-balao');
  _esconderBalao();
  svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

  // ── Fase 2 (após 160ms = duração do fade-out): troca conteúdo + highlight ──
  _tourTimeout(function() {

    // Atualiza conteúdo do balão enquanto está invisível
    document.getElementById('tour-titulo').textContent = passo.titulo;
    document.getElementById('tour-desc').textContent = passo.desc;
    document.getElementById('tour-progresso').textContent = (i + 1) + ' / ' + _tourPassos.length;
    _tourMenuAtualizar(i);

    const btnAnt   = document.getElementById('tour-btn-ant');
    const btnProx  = document.getElementById('tour-btn-prox');
    const btnPular = document.getElementById('tour-btn-pular');
    btnAnt.style.display = i === 0 ? 'none' : 'flex';
    btnProx.textContent  = i === _tourPassos.length - 1 ? '✓ Concluir' : 'Próximo →';
    // Garante que os botões apontam para as funções do tour mensal
    btnProx.onclick = tourProximo;
    btnAnt.onclick  = tourAnterior;
    if (btnPular) btnPular.onclick = tourPular;

    const rects = els.map(el => _getRectPadded(el, passo));
    const useCircle = !!passo.circulo;

    function addHole(x, y, w, h, rx, circle) {
      const el = document.createElementNS(ns, circle ? 'ellipse' : 'rect');
      if (circle) {
        el.setAttribute('cx', x + w/2); el.setAttribute('cy', y + h/2);
        el.setAttribute('rx', w/2); el.setAttribute('ry', h/2);
      } else {
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', w); el.setAttribute('height', h);
        el.setAttribute('rx', rx || 10);
      }
      el.setAttribute('fill', 'black');
      el.classList.add('tour-dyn');
      mask.appendChild(el);
    }
    function addBorder(x, y, w, h, rx, circle) {
      const el = document.createElementNS(ns, circle ? 'ellipse' : 'rect');
      if (circle) {
        el.setAttribute('cx', x + w/2); el.setAttribute('cy', y + h/2);
        el.setAttribute('rx', w/2 + 2); el.setAttribute('ry', h/2 + 2);
      } else {
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', w); el.setAttribute('height', h);
        el.setAttribute('rx', rx || 10);
      }
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'rgba(58,110,220,0.85)');
      el.setAttribute('stroke-width', '2.5');
      el.classList.add('tour-dyn');
      svg.appendChild(el);
    }

    let ancX = 0, ancY = 0, ancRight = window.innerWidth, ancBottom = window.innerHeight;
    let ancCx = window.innerWidth / 2, ancCy = window.innerHeight / 2;

    if (!passo._semHighlightInicial) {
      if (passo.separados) {
        rects.forEach(r => {
          addHole(r.x, r.y, r.w, r.h, 10, useCircle);
          addBorder(r.x, r.y, r.w, r.h, 10, useCircle);
        });
        ancX      = Math.min(...rects.map(r => r.x));
        ancY      = Math.min(...rects.map(r => r.y));
        ancRight  = Math.max(...rects.map(r => r.right));
        ancBottom = Math.max(...rects.map(r => r.bottom));
        ancCx = (Math.max(...rects.map(r => r.x)) + Math.min(...rects.map(r => r.right))) / 2;
        ancCy = (ancY + ancBottom) / 2;
      } else {
        const x      = Math.min(...rects.map(r => r.x));
        const y      = Math.min(...rects.map(r => r.y));
        const right  = Math.max(...rects.map(r => r.right));
        const bottom = Math.max(...rects.map(r => r.bottom));
        const w = right - x, h = bottom - y;
        addHole(x, y, w, h, 10, false);
        addBorder(x, y, w, h, 10, false);
        ancX = x; ancY = y; ancRight = right; ancBottom = bottom;
        ancCx = x + w/2; ancCy = y + h/2;
      }

      const bW = 300;
      const bH = balao.offsetHeight || 200;
      const marg = 14;
      const z = _getCssZoom();
      const vW = window.innerWidth  / z;
      const vH = window.innerHeight / z;
      const espacoAbaixo = vH - ancBottom;
      const espacoAcima  = ancY;
      let bTop, bLeft;

      if (passo.separados) {
        bLeft = ancCx - bW / 2;
        if (espacoAbaixo >= bH + marg)      bTop = ancBottom + marg;
        else if (espacoAcima >= bH + marg)  bTop = ancY - marg - bH;
        else                                bTop = ancCy - bH / 2;
      } else {
        if (espacoAbaixo >= bH + marg) {
          bTop  = ancBottom + marg;
          bLeft = ancCx - bW / 2;
        } else if (espacoAcima >= bH + marg) {
          bTop  = ancY - marg - bH;
          bLeft = ancCx - bW / 2;
        } else {
          bTop  = vH / 2 - bH / 2;
          bLeft = vW / 2 - bW / 2;
        }
      }

      bLeft = Math.max(16, Math.min(bLeft, vW - bW - 16));
      bTop  = Math.max(16, Math.min(bTop,  vH - bH - 16));
      balao.style.top  = bTop + 'px';
      balao.style.left = bLeft + 'px';
      _mostrarBalao();
    }

    // Para passos _semHighlightInicial: onEntrar cuida de desenhar highlight e chamar _mostrarBalao
    if (passo.onEntrar) passo.onEntrar.call(passo);

  }, 160);
}

function tourProximo() {
  if (_tourAtual < _tourPassos.length - 1) {
    if (_tourAtual === 0) _tourMenuMostrar();
    _tourAtual++;
    _exibirPassoTour(_tourAtual);
  } else {
    tourPular();
  }
}

function tourAnterior() {
  if (_tourAtual > 0) {
    _tourAtual--;
    _exibirPassoTour(_tourAtual);
  }
}

function tourPular() {
  _clearTourTimers();
  _tourRemoverSimulacao();
  if (_tourPassos[_tourAtual] && _tourPassos[_tourAtual].onSair) _tourPassos[_tourAtual].onSair();
  fecharDadosMenu();
  document.querySelectorAll('.select-banco-list.open').forEach(l => l.classList.remove('open'));
  const svg = document.getElementById('tour-overlay');
  svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
  svg.style.display = 'none';
  document.getElementById('tour-bloqueador').style.display = 'none';
  _esconderBalao();
  tourFecharIndice();
  const btnIndice = document.getElementById('tour-btn-indice');
  if (btnIndice) btnIndice.remove();
  document.body.classList.remove('tour-ativo');
  _restaurarSnapshot();
}
/* ── MENU DADOS (botão flutuante) ── */
let _dadosMenuAberto = false;

function toggleDadosMenu() {
  if (_dadosMenuAberto) {
    fecharDadosMenu();
  } else {
    abrirDadosMenu();
  }
}

function _abrirDadosMenuTour() {
  const menu = document.getElementById("dados-menu");
  if (!menu) return;
  _dadosMenuAberto = true;
  menu.style.display = "block";
  requestAnimationFrame(() => {
    menu.style.opacity = "1";
    menu.style.transform = "translateX(-50%) translateY(0) scale(1)";
    menu.style.pointerEvents = "auto";
  });
  // Não registra _fecharDadosMenuExterno — o tour controla o fechamento
}

function abrirDadosMenu() {
  const menu = document.getElementById("dados-menu");
  if (!menu) return;
  _dadosMenuAberto = true;
  menu.style.display = "block";
  requestAnimationFrame(() => {
    menu.style.opacity = "1";
    menu.style.transform = "translateX(-50%) translateY(0) scale(1)";
    menu.style.pointerEvents = "auto";
  });
  document.addEventListener("click", _fecharDadosMenuExterno, true);
}

function fecharDadosMenu() {
  const menu = document.getElementById("dados-menu");
  if (!menu) return;
  _dadosMenuAberto = false;
  menu.style.opacity = "0";
  menu.style.transform = "translateX(-50%) translateY(8px) scale(0.96)";
  menu.style.pointerEvents = "none";
  setTimeout(() => { menu.style.display = "none"; }, 200);
  document.removeEventListener("click", _fecharDadosMenuExterno, true);
}

function _fecharDadosMenuExterno(e) {
  const btn = document.getElementById("btn-dados");
  const menu = document.getElementById("dados-menu");
  if (btn && btn.contains(e.target)) return;
  if (menu && menu.contains(e.target)) return;
  fecharDadosMenu();
}
/* ══════════════════════════════════════════════════════════════════
   MODO NOTURNO
   ══════════════════════════════════════════════════════════════════ */
function toggleDarkMode() {
  // Desabilita transitions para tudo mudar simultaneamente
  const noTrans = document.createElement('style');
  noTrans.id = '_dark-notransition';
  noTrans.textContent = '*, *::before, *::after { transition: none !important; }';
  document.head.appendChild(noTrans);

  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("planova_dark_mode", isDark ? "1" : "0");
  _syncIconesDark(isDark);
  // Re-aplica cores de todos os bancos já renderizados
  sincronizarDropdownsBancos();

  // Reativa transitions após o browser pintar o novo estado
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      const el = document.getElementById('_dark-notransition');
      if (el) el.remove();
    });
  });
}

function _syncIconesDark(isDark) {
  const tip = document.querySelector("#btn-dark-mode .fab-tooltip");
  if (tip) tip.textContent = isDark ? "Modo claro" : "Modo noturno";
  // Visual do toggle é controlado via CSS com body.dark
}

/* Aplica preferência salva ao carregar */
(function() {
  if (localStorage.getItem("planova_dark_mode") === "1") {
    document.body.classList.add("dark");
    const apply = () => {
      if (document.getElementById("dark-icon-lua")) _syncIconesDark(true);
      else requestAnimationFrame(apply);
    };
    requestAnimationFrame(apply);
  }
})();
/* ══════════════════════════════════════════════════════════════════════
 *  VISÃO ANUAL
 * ══════════════════════════════════════════════════════════════════════ */

let _anualAno = new Date().getFullYear();
let _anualDados = { faturado: [], gastos: [], saldo: [], reserva: [] };
let _anualModoEditar = false;

const MESES_CURTOS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// Ordem padrão: saldo é o protagonista (posição 0)
const _ANUAL_ORDEM_KEY = 'planova_anual_ordem';
const _ANUAL_WIDGETS_DEFAULT = ['saldo', 'faturado', 'gastos', 'reserva'];

function _anualGetOrdem() {
  try {
    const raw = localStorage.getItem(_ANUAL_ORDEM_KEY);
    if (!raw) return [..._ANUAL_WIDGETS_DEFAULT];
    const parsed = JSON.parse(raw);
    // Valida que tem os 4 widgets
    if (Array.isArray(parsed) && parsed.length === 4 &&
        _ANUAL_WIDGETS_DEFAULT.every(w => parsed.includes(w))) return parsed;
  } catch(e) {}
  return [..._ANUAL_WIDGETS_DEFAULT];
}

function _anualSalvarOrdem(ordem) {
  localStorage.setItem(_ANUAL_ORDEM_KEY, JSON.stringify(ordem));
}

// Definições de cada widget
const _ANUAL_WIDGET_DEF = {
  saldo: {
    id: 'widget-saldo',
    cor: 'azul',
    iconeCor: 'anual-widget-icon--azul',
    iconeSize: 26,
    label: 'Saldo do Período',
    desc: 'Entrada menos gastos em ',
    descId: 'anual-saldo-ano-label',
    totalId: 'anual-saldo-total',
    sparkId: 'spark-saldo',
    popup: 'saldo',
    svgPath: `<line x1="12" y1="3" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="4" y1="7" x2="20" y2="7"/><path d="M4 7 L1 13 Q4 16.5 7 13 Z"/><path d="M20 7 L17 13 Q20 16.5 23 13 Z"/>`,
  },
  faturado: {
    id: 'widget-faturado',
    cor: 'verde',
    iconeCor: 'anual-widget-icon--verde',
    iconeSize: 22,
    label: 'Total Faturado',
    desc: 'Salário bruto em ',
    descId: 'anual-faturado-ano-label',
    totalId: 'anual-faturado-total',
    sparkId: 'spark-faturado',
    popup: 'faturado',
    svgPath: `<path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="17.5" cy="13.5" r="1.5" fill="currentColor" stroke="none"/>`,
  },
  gastos: {
    id: 'widget-gastos',
    cor: 'vermelho',
    iconeCor: 'anual-widget-icon--vermelho',
    iconeSize: 22,
    label: 'Total Gasto',
    desc: 'Gastos brutos em ',
    descId: 'anual-gastos-ano-label',
    totalId: 'anual-gastos-total',
    sparkId: 'spark-gastos',
    popup: 'gastos',
    svgPath: `<path d="M4 2v20l3-2 2 2 2-2 2 2 2-2 3 2V2l-3 2-2-2-2 2-2-2-2 2-3-2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>`,
  },
  reserva: {
    id: 'widget-reserva',
    cor: 'dourado',
    iconeCor: 'anual-widget-icon--dourado',
    iconeSize: 22,
    label: 'Reserva Guardada',
    desc: 'Depósitos na reserva em ',
    descId: 'anual-reserva-ano-label',
    totalId: 'anual-reserva-total',
    sparkId: 'spark-reserva',
    popup: 'reserva',
    svgPath: `<rect x="2" y="3" width="20" height="16" rx="2"/><circle cx="12" cy="11" r="3.5"/><circle cx="12" cy="11" r="1.2" fill="currentColor" stroke="none"/><line x1="7" y1="19" x2="7" y2="21"/><line x1="17" y1="19" x2="17" y2="21"/><line x1="16.5" y1="6.5" x2="19" y2="6.5"/><line x1="16.5" y1="9.5" x2="19" y2="9.5"/>`,
  },
};

function _anualBuildGrid() {
  const grid   = document.getElementById('anual-grid');
  const ordem  = _anualGetOrdem();
  const heroi  = ordem[0];
  const outros = ordem.slice(1);

  grid.innerHTML = '';

  // ── Widget protagonista ──
  const def = _ANUAL_WIDGET_DEF[heroi];
  const heroEl = document.createElement('div');
  heroEl.className = 'anual-widget anual-widget--saldo';
  heroEl.id = def.id;
  heroEl.dataset.key = heroi;
  heroEl.innerHTML = `
    <div class="anual-widget-top">
      <div class="anual-widget-icon ${def.iconeCor}">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${def.svgPath}</svg>
      </div>
      <div class="anual-widget-info">
        <div class="anual-widget-label">${def.label}</div>
        <div class="anual-widget-total ${heroi === 'saldo' ? 'azul' : def.cor}" id="${def.totalId}">R$ 0,00</div>
        <div class="anual-widget-desc">${def.desc || ''}<span id="${def.descId}">${_anualAno}</span></div>
      </div>
    </div>
    <div class="anual-proporcao-wrap" id="anual-proporcao-wrap" style="display:none;">
      <div class="anual-proporcao-track">
        <div class="anual-proporcao-gasto" id="anual-proporcao-gasto"></div>
        <div class="anual-proporcao-saldo" id="anual-proporcao-saldo"></div>
      </div>
      <div class="anual-proporcao-legenda">
        <span class="anual-prop-leg anual-prop-leg--gasto"><span class="anual-prop-dot anual-prop-dot--gasto"></span><span id="anual-prop-pct-gasto">0%</span> gasto</span>
        <span class="anual-prop-leg anual-prop-leg--saldo"><span class="anual-prop-dot anual-prop-dot--saldo"></span><span id="anual-prop-pct-saldo">0%</span> sobrou</span>
      </div>
    </div>
    <div class="anual-insight-inline" id="anual-insight-row" style="display:none;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="anual-insight-icon" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span id="anual-insight-texto"></span>
    </div>
    <div class="anual-sparkline-wrap anual-sparkline-wrap--lg">
      <div class="anual-sparkline anual-sparkline--lg" id="${def.sparkId}"></div>
      <div class="anual-spark-meses" id="spark-meses-saldo"></div>
    </div>
    <div class="anual-widget-cta">Ver detalhes →</div>
  `;
  if (!_anualModoEditar) heroEl.onclick = () => anualAbrirPopup(heroi);
  grid.appendChild(heroEl);

  // ── Coluna direita com 3 widgets compactos ──
  const colDir = document.createElement('div');
  colDir.className = 'anual-col-direita';

  outros.forEach(function(key) {
    const d = _ANUAL_WIDGET_DEF[key];
    const el = document.createElement('div');
    el.className = 'anual-widget anual-widget--sm';
    el.id = d.id;
    el.dataset.key = key;
    el.innerHTML = `
      <div class="anual-widget-icon ${d.iconeCor}">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d.svgPath}</svg>
      </div>
      <div class="anual-widget-info">
        <div class="anual-widget-label">${d.label}</div>
        <div class="anual-widget-total ${key === 'saldo' ? 'azul' : d.cor}" id="${d.totalId}">R$ 0,00</div>
        <div class="anual-widget-desc">${key === 'saldo' ? 'Entrada menos gastos em ' : (d.desc || '')} <span id="${d.descId}">${_anualAno}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;margin-left:auto;">
        <span class="anual-tendencia-badge" id="tendencia-${key}" style="display:none;"></span>
        <div class="anual-sparkline-wrap anual-sparkline-wrap--mini">
          <div class="anual-sparkline anual-sparkline--mini" id="${d.sparkId}"></div>
        </div>
      </div>
    `;
    if (!_anualModoEditar) el.onclick = () => anualAbrirPopup(key);
    colDir.appendChild(el);
  });

  grid.appendChild(colDir);

  if (_anualModoEditar) _anualAtivarDrag();
}

let _anualOrdemOriginal = null; // guarda a ordem ao entrar no modo editar

function _anualAtualizarBtnEditar() {
  const btn    = document.getElementById('btn-anual-editar');
  if (!btn) return;
  const mudou  = _anualOrdemOriginal &&
                 JSON.stringify(_anualGetOrdem()) !== JSON.stringify(_anualOrdemOriginal);
  if (mudou) {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Salvar';
  } else {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Personalizar';
  }
}

function anualToggleEditar() {
  _anualModoEditar = !_anualModoEditar;
  const btn  = document.getElementById('btn-anual-editar');
  const grid = document.getElementById('anual-grid');
  if (_anualModoEditar) {
    _anualOrdemOriginal = _anualGetOrdem().slice(); // snapshot da ordem atual
    btn.classList.add('ativo');
    grid.classList.add('modo-editar');
    grid.querySelectorAll('.anual-widget').forEach(function(w) {
      if (!w.querySelector('.anual-drag-hint')) {
        const h = document.createElement('div');
        h.className = 'anual-drag-hint';
        h.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg> mover';
        w.appendChild(h);
      }
      w.onclick = null;
    });
    _anualAtivarDrag();
  } else {
    _anualOrdemOriginal = null;
    btn.classList.remove('ativo');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Personalizar';
    grid.classList.remove('modo-editar');
    _anualBuildGrid();
    anualCarregar();
  }
}

function _anualAtivarDrag() {
  const grid    = document.getElementById('anual-grid');
  const widgets = grid.querySelectorAll('.anual-widget');
  let dragKey   = null;

  widgets.forEach(function(w) {
    w.draggable = true;

    w.addEventListener('dragstart', function(e) {
      dragKey = w.dataset.key;
      w.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    w.addEventListener('dragend', function() {
      w.classList.remove('dragging');
      grid.querySelectorAll('.anual-widget').forEach(x => x.classList.remove('drag-over'));
    });

    w.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (w.dataset.key !== dragKey) {
        grid.querySelectorAll('.anual-widget').forEach(x => x.classList.remove('drag-over'));
        w.classList.add('drag-over');
      }
    });

    w.addEventListener('dragleave', function() {
      w.classList.remove('drag-over');
    });

    w.addEventListener('drop', function(e) {
      e.preventDefault();
      w.classList.remove('drag-over');
      if (!dragKey || w.dataset.key === dragKey) return;

      const ordem = _anualGetOrdem();
      const fromIdx = ordem.indexOf(dragKey);
      const toIdx   = ordem.indexOf(w.dataset.key);
      if (fromIdx === -1 || toIdx === -1) return;

      // Troca simples entre as duas posições
      const tmp = ordem[fromIdx];
      ordem[fromIdx] = ordem[toIdx];
      ordem[toIdx] = tmp;
      _anualSalvarOrdem(ordem);

      // Reconstrói e mantém modo edição
      _anualBuildGrid();
      anualCarregar();
      // Reativa drag após rebuild
      const grid2 = document.getElementById('anual-grid');
      grid2.classList.add('modo-editar');
      _anualAtivarDrag();
      _anualAtualizarBtnEditar();
    });
  });
}

function anualNavegar(delta) {
  _anualAno += delta;
  anualCarregar();
}

function anualCarregar() {
  const ordem = _anualGetOrdem();
  _anualBuildGrid();

  document.getElementById('anual-titulo-ano').textContent = _anualAno;
  // Atualiza labels de ano nos widgets
  ['saldo','faturado','gastos','reserva'].forEach(function(key) {
    const el = document.getElementById(_ANUAL_WIDGET_DEF[key].descId);
    if (el) el.textContent = _anualAno;
  });

  const faturadoPorMes = [];
  const gastosPorMes   = [];

  for (let m = 0; m < 12; m++) {
    const chave = 'planejamento_' + _anualAno + '_' + m;
    const raw   = localStorage.getItem(chave);
    if (!raw) { faturadoPorMes.push(0); gastosPorMes.push(0); continue; }
    let dados = {};
    try { dados = JSON.parse(raw); } catch(e) { faturadoPorMes.push(0); gastosPorMes.push(0); continue; }

    const sal1 = num(dados.sal1 || '');
    const sal2 = num(dados.sal2 || '');

    const extrasChave = 'extras_sal_' + _anualAno + '_' + m;
    const extrasRaw   = localStorage.getItem(extrasChave);
    let extrasSoma = 0;
    if (extrasRaw) {
      try {
        const extDados = JSON.parse(extrasRaw);
        [1, 2].forEach(entrada => {
          const lista   = extDados[String(entrada)] || [];
          const isSomar = extDados['info' + entrada] === true;
          if (isSomar) lista.forEach(e => { extrasSoma += num(e.valor || ''); });
        });
      } catch(e) {}
    }
    faturadoPorMes.push(sal1 + sal2 + extrasSoma);

    let totalGastos = 0;
    Object.keys(dados).forEach(k => {
      if (k.endsWith('_val')) totalGastos += num(dados[k] || '');
    });

    // Inclui alocações do Diário (períodos vinculados) nos gastos do mês
    try {
      const alocRaw = localStorage.getItem('diario_alocacao_v1');
      if (alocRaw) {
        const alocAll = JSON.parse(alocRaw);
        const alocMes = alocAll[_anualAno + '_' + m] || {};
        totalGastos += parseFloat(alocMes['1'] || 0) + parseFloat(alocMes['2'] || 0);
      }
    } catch(e) {}

    gastosPorMes.push(totalGastos);
  }

  _anualDados.faturado = faturadoPorMes;
  _anualDados.gastos   = gastosPorMes;
  _anualDados.saldo    = faturadoPorMes.map((f, i) => f - gastosPorMes[i]);

  const reservaPorMes = [];
  for (let m = 0; m < 12; m++) {
    const v = parseFloat(localStorage.getItem('dep_reserva_' + _anualAno + '_' + m) || '0');
    reservaPorMes.push(v);
  }
  _anualDados.reserva = reservaPorMes;

  const totalFaturado = faturadoPorMes.reduce((a,b) => a+b, 0);
  const totalGastos   = gastosPorMes.reduce((a,b) => a+b, 0);
  const totalSaldo    = totalFaturado - totalGastos;
  const totalReserva  = reservaPorMes.reduce((a,b) => a+b, 0);

  // Totais
  document.getElementById('anual-faturado-total').textContent  = _anualFmt(totalFaturado);
  document.getElementById('anual-gastos-total').textContent    = _anualFmt(totalGastos);
  document.getElementById('anual-reserva-total').textContent   = _anualFmt(totalReserva);

  const saldoEl = document.getElementById('anual-saldo-total');
  if (saldoEl) {
    saldoEl.textContent = _anualFmt(Math.abs(totalSaldo));
    saldoEl.className   = 'anual-widget-total ' + (totalSaldo >= 0 ? 'azul' : 'vermelho-saldo');
  }

  // Badges de tendência — compara último mês com dados vs penúltimo mês com dados
  (function() {
    // Monta array de meses com dados no ano atual (índice + totais)
    const mesesComDados = [];
    for (let m = 0; m < 12; m++) {
      const fat = faturadoPorMes[m];
      const gas = gastosPorMes[m];
      const res = reservaPorMes[m];
      if (fat > 0 || gas > 0) {
        mesesComDados.push({ m, faturado: fat, gastos: gas, saldo: fat - gas, reserva: res });
      }
    }

    // Precisa de pelo menos 2 meses para comparar
    if (mesesComDados.length < 2) {
      ['faturado','gastos','saldo','reserva'].forEach(function(key) {
        const b = document.getElementById('tendencia-' + key);
        if (b) b.style.display = 'none';
      });
      return;
    }

    const ultimo    = mesesComDados[mesesComDados.length - 1];
    const penultimo = mesesComDados[mesesComDados.length - 2];

    const MESES_CURTOS2 = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    const inverterKey = { faturado: false, gastos: true, saldo: false, reserva: false };

    ['faturado','gastos','saldo','reserva'].forEach(function(key) {
      const badge = document.getElementById('tendencia-' + key);
      if (!badge) return;

      const atual = ultimo[key];
      const ant   = penultimo[key];

      // Saldo pode ser zero ou negativo — tratar separado
      if (key === 'saldo') {
        const diff = atual - ant;
        if (Math.abs(diff) < 0.5) { badge.style.display = 'none'; return; }
        const subindo  = diff > 0;
        badge.textContent = (subindo ? '↑' : '↓') + ' ' + _anualFmt(Math.abs(diff)).replace('R$ ','');
        badge.className   = 'anual-tendencia-badge ' + (subindo ? 'tendencia-pos' : 'tendencia-neg');
        badge.title = 'vs. ' + MESES_CURTOS2[penultimo.m];
        badge.style.display = '';
        return;
      }

      if (ant <= 0 || atual <= 0) { badge.style.display = 'none'; return; }
      const diff = ((atual - ant) / ant) * 100;
      if (Math.abs(diff) < 0.5) { badge.style.display = 'none'; return; }
      const subindo  = diff > 0;
      const positivo = inverterKey[key] ? !subindo : subindo;
      badge.textContent = (subindo ? '↑' : '↓') + ' ' + Math.abs(diff).toFixed(0) + '%';
      badge.className   = 'anual-tendencia-badge ' + (positivo ? 'tendencia-pos' : 'tendencia-neg');
      badge.title = 'vs. ' + MESES_CURTOS2[penultimo.m];
      badge.style.display = '';
    });
  })();

  // Sparklines — protagonista usa sparkline grande, os outros mini
  const heroi = ordem[0];
  const sparkLg = document.getElementById(_ANUAL_WIDGET_DEF[heroi].sparkId);
  if (sparkLg) sparkLg.className = 'anual-sparkline anual-sparkline--lg';

  // Renderiza sparklines por widget
  const dadosPorKey = { faturado: faturadoPorMes, gastos: gastosPorMes, saldo: _anualDados.saldo, reserva: reservaPorMes };
  const corPorKey   = { faturado: 'verde', gastos: 'vermelho', saldo: null, reserva: 'dourado' };

  ordem.forEach(function(key, idx) {
    if (idx === 0) {
      // Protagonista: sparkline grande com meses
      _anualRenderSparklineSaldo(_ANUAL_WIDGET_DEF[key].sparkId, 'spark-meses-saldo', dadosPorKey[key], corPorKey[key]);
    } else {
      // Mini: saldo usa azul-pos (cor fixa, sem lógica pos/neg)
      const corMini = (key === 'saldo') ? 'azul-pos' : (corPorKey[key] || 'azul-pos');
      _anualRenderSparklineMini(_ANUAL_WIDGET_DEF[key].sparkId, dadosPorKey[key], corMini);
    }
  });

  // Proporção e insight — sempre com dados de saldo
  _anualRenderProporcao(totalFaturado, totalGastos, totalSaldo);
  _anualRenderInsight(totalFaturado, totalGastos, totalSaldo, faturadoPorMes, gastosPorMes, reservaPorMes, heroi);

  // Se modo edição estava ativo, reativa drag e hints
  if (_anualModoEditar) {
    const grid = document.getElementById('anual-grid');
    grid.classList.add('modo-editar');
    grid.querySelectorAll('.anual-widget').forEach(function(w) {
      if (!w.querySelector('.anual-drag-hint')) {
        const h = document.createElement('div');
        h.className = 'anual-drag-hint';
        h.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg> mover';
        w.appendChild(h);
      }
      w.onclick = null;
    });
    _anualAtivarDrag();
  }
}

function _anualFmt(v) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _anualRenderBars(containerId, valores, cor) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const maxVal    = Math.max(...valores, 1);
  const mesAtual  = new Date().getMonth();
  const anoReal   = new Date().getFullYear();

  container.innerHTML = '';
  valores.forEach((val, i) => {
    const pct        = Math.max((val / maxVal) * 190, val > 0 ? 8 : 4);
    const isDestaque = (_anualAno === anoReal && i === mesAtual);

    const col = document.createElement('div');
    col.className = 'anual-bar-col' + (isDestaque ? ' destaque' : '');

    const labelValor = document.createElement('div');
    labelValor.className = 'anual-bar-valor';
    labelValor.textContent = val > 0 ? _anualFmt(val) : '—';

    const track = document.createElement('div');
    track.className = 'anual-bar-track anual-bar-track--' + (val > 0 ? cor : 'vazio');
    track.style.height = pct + 'px';

    const labelMes = document.createElement('div');
    labelMes.className = 'anual-bar-mes';
    labelMes.textContent = MESES_CURTOS[i];

    col.appendChild(labelValor);
    col.appendChild(track);
    col.appendChild(labelMes);
    container.appendChild(col);
  });
}

function anualAbrirPopup(tipo) {
  if (!_anualDados.faturado.length) anualCarregar();
  const isFaturado = tipo === 'faturado';
  const isSaldo    = tipo === 'saldo';
  const isReserva  = tipo === 'reserva';

  const titulo  = isFaturado ? 'Total Faturado' : isSaldo ? 'Saldo do Período' : isReserva ? 'Reserva Guardada' : 'Total Gasto';
  const valores = isFaturado ? _anualDados.faturado : isSaldo ? _anualDados.saldo : isReserva ? _anualDados.reserva : _anualDados.gastos;
  const total   = valores.reduce((a,b) => a+b, 0);

  const iconCor = isFaturado ? '#16a34a' : isSaldo ? '#1c3f91' : isReserva ? '#a16207' : '#dc2626';
  const iconBg  = isFaturado ? 'rgba(34,197,94,0.12)' : isSaldo ? 'rgba(58,110,220,0.10)' : isReserva ? 'rgba(202,138,4,0.12)' : 'rgba(239,68,68,0.10)';
  const svgPath = isFaturado
    ? '<path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="17.5" cy="13.5" r="1.5" fill="' + iconCor + '" stroke="none"/>'
    : isSaldo
    ? '<line x1="12" y1="3" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="4" y1="7" x2="20" y2="7"/><path d="M4 7 L1 13 Q4 16.5 7 13 Z"/><path d="M20 7 L17 13 Q20 16.5 23 13 Z"/>'
    : isReserva
    ? '<rect x="2" y="3" width="20" height="16" rx="2"/><circle cx="12" cy="11" r="3.5"/><circle cx="12" cy="11" r="1.2" fill="' + iconCor + '" stroke="none"/><line x1="7" y1="19" x2="7" y2="21"/><line x1="17" y1="19" x2="17" y2="21"/><line x1="16.5" y1="6.5" x2="19" y2="6.5"/><line x1="16.5" y1="9.5" x2="19" y2="9.5"/>'
    : '<path d="M4 2v20l3-2 2 2 2-2 2 2 2-2 3 2V2l-3 2-2-2-2 2-2-2-2 2-3-2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>';

  document.getElementById('anual-popup-titulo').textContent    = titulo;
  document.getElementById('anual-popup-subtitulo').textContent = 'Ano ' + _anualAno;
  const totalEl = document.getElementById('anual-popup-total');
  totalEl.textContent = (isSaldo && total < 0 ? '− ' : '') + _anualFmt(Math.abs(total));
  const isDark = document.body.classList.contains('dark');
  totalEl.style.color = isSaldo
    ? (total >= 0 ? (isDark ? 'rgba(255,255,255,0.92)' : '#0f1f5c') : '#dc2626')
    : (isDark ? 'rgba(255,255,255,0.92)' : '#0f1f5c');

  const iconEl = document.getElementById('anual-popup-icon');
  iconEl.style.background = iconBg;
  iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${iconCor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;

  if (isSaldo) {
    _anualRenderBarsSaldo('bars-popup', valores);
  } else {
    _anualRenderBars('bars-popup', valores, isFaturado ? 'verde' : isReserva ? 'dourado' : 'vermelho');
  }

  const overlay = document.getElementById('anual-popup-overlay');
  const popup   = document.getElementById('anual-popup');
  overlay.style.display = 'block';
  popup.style.display   = 'block';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      popup.style.opacity   = '1';
      popup.style.transform = 'translate(-50%,-50%) scale(1)';
      popup.style.pointerEvents = 'auto';
    });
  });
}

function _anualRenderBarsSaldo(containerId, valores) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const maxAbs   = Math.max(...valores.map(v => Math.abs(v)), 1);
  const mesAtual = new Date().getMonth();
  const anoReal  = new Date().getFullYear();

  container.innerHTML = '';
  valores.forEach((val, i) => {
    const isPositivo = val >= 0;
    const pct        = Math.max((Math.abs(val) / maxAbs) * 190, Math.abs(val) > 0 ? 8 : 4);
    const isDestaque = (_anualAno === anoReal && i === mesAtual);

    const col = document.createElement('div');
    col.className = 'anual-bar-col' + (isDestaque ? ' destaque' : '');

    const labelValor = document.createElement('div');
    labelValor.className = 'anual-bar-valor';
    labelValor.style.color = val === 0 ? '' : isPositivo ? '#1c3f91' : '#c83232';
    labelValor.textContent = val === 0 ? '—' : (isPositivo ? '' : '− ') + _anualFmt(Math.abs(val));

    const track = document.createElement('div');
    track.className = 'anual-bar-track anual-bar-track--' + (val === 0 ? 'vazio' : isPositivo ? 'azul' : 'negativo');
    track.style.height = (val === 0 ? 4 : pct) + 'px';

    const labelMes = document.createElement('div');
    labelMes.className = 'anual-bar-mes';
    labelMes.textContent = MESES_CURTOS[i];

    col.appendChild(labelValor);
    col.appendChild(track);
    col.appendChild(labelMes);
    container.appendChild(col);
  });
}

/* ── Sparkline mini — cards compactos (sem labels de mês) ── */
function _anualRenderSparklineMini(barId, valores, cor) {
  const barWrap = document.getElementById(barId);
  if (!barWrap) return;
  const maxVal   = Math.max(...valores, 1);
  const mesAtual = new Date().getMonth();
  const anoReal  = new Date().getFullYear();

  barWrap.innerHTML = '';
  valores.forEach((val, i) => {
    const isDestaque = (_anualAno === anoReal && i === mesAtual);
    const pct = Math.max((val / maxVal) * 100, val > 0 ? 10 : 3);
    const bar = document.createElement('div');
    bar.className = 'anual-spark-bar anual-spark-bar--' + (val > 0 ? cor : 'vazio')
      + (isDestaque && val > 0 ? ' anual-spark-bar--destaque' : '');
    bar.style.height = pct + '%';
    barWrap.appendChild(bar);
  });
}

/* ── Sparkline grande — card protagonista (com barras e labels de mês) ── */
function _anualRenderSparklineSaldo(barId, mesId, valores, corOverride) {
  const barWrap = document.getElementById(barId);
  const mesWrap = document.getElementById(mesId);
  if (!barWrap) return;
  const maxAbs   = Math.max(...valores.map(v => Math.abs(v)), 1);
  const mesAtual = new Date().getMonth();
  const anoReal  = new Date().getFullYear();
  const MESES_MIN = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  barWrap.innerHTML = '';
  if (mesWrap) mesWrap.innerHTML = '';

  valores.forEach((val, i) => {
    const isDestaque = (_anualAno === anoReal && i === mesAtual);
    const pct = Math.max((Math.abs(val) / maxAbs) * 100, Math.abs(val) > 0 ? 8 : 3);
    let corBase;
    if (corOverride) {
      corBase = val === 0 ? 'vazio' : corOverride;
    } else {
      const isPos = val >= 0;
      corBase = val === 0 ? 'vazio' : (isPos ? 'azul-pos' : 'azul-neg');
    }

    const bar = document.createElement('div');
    bar.className = 'anual-spark-bar anual-spark-bar--' + corBase
      + (isDestaque && val !== 0 ? ' anual-spark-bar--destaque' : '');
    bar.style.height = pct + '%';

    if (isDestaque) {
      const col = document.createElement('div');
      col.className = 'anual-spark-col-destaque';
      const dot = document.createElement('div');
      dot.className = 'anual-spark-dot-atual';
      col.appendChild(dot);
      col.appendChild(bar);
      barWrap.appendChild(col);
    } else {
      barWrap.appendChild(bar);
    }

    if (mesWrap) {
      const lbl = document.createElement('div');
      lbl.className = 'anual-spark-mes' + (isDestaque ? ' anual-spark-mes--destaque' : '');
      lbl.textContent = MESES_MIN[i];
      mesWrap.appendChild(lbl);
    }
  });
}

/* ── Barra de proporção faturado × gasto (card Saldo) ── */
function _anualRenderProporcao(totalFaturado, totalGastos, totalSaldo) {
  const wrap = document.getElementById('anual-proporcao-wrap');
  const gastoEl  = document.getElementById('anual-proporcao-gasto');
  const saldoEl2 = document.getElementById('anual-proporcao-saldo');
  const pctGastoEl  = document.getElementById('anual-prop-pct-gasto');
  const pctSaldoEl  = document.getElementById('anual-prop-pct-saldo');
  if (!wrap || !gastoEl) return;

  if (totalFaturado <= 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const pctGasto = Math.min((totalGastos / totalFaturado) * 100, 100);
  const pctSaldo = Math.max(100 - pctGasto, 0);

  gastoEl.style.width  = pctGasto.toFixed(1) + '%';
  saldoEl2.style.width = pctSaldo.toFixed(1) + '%';
  pctGastoEl.textContent  = pctGasto.toFixed(0) + '%';
  pctSaldoEl.textContent  = pctSaldo.toFixed(0) + '%';
}

/* ── Linha de insight dinâmica ── */
function _anualRenderInsight(totalFaturado, totalGastos, totalSaldo, faturadoPorMes, gastosPorMes, reservaPorMes, heroi) {
  const row     = document.getElementById('anual-insight-row');
  const textoEl = document.getElementById('anual-insight-texto');
  if (!row || !textoEl) return;

  const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const mesesComDado = faturadoPorMes.filter(v => v > 0).length;

  if (mesesComDado === 0 && heroi !== 'reserva') { row.style.display = 'none'; return; }
  row.style.display = 'flex';

  let insight = '';

  if (heroi === 'saldo') {
    const pctGasto = (totalGastos / totalFaturado) * 100;
    let melhorMes = -1, melhorSaldo = -Infinity;
    for (let i = 0; i < 12; i++) {
      if (faturadoPorMes[i] > 0) {
        const s = faturadoPorMes[i] - gastosPorMes[i];
        if (s > melhorSaldo) { melhorSaldo = s; melhorMes = i; }
      }
    }
    if (pctGasto > 100) {
      insight = `Você gastou mais do que faturou em ${_anualAno}. O saldo ficou negativo em ${_anualFmt(Math.abs(totalSaldo))}.`;
    } else if (melhorMes >= 0) {
      const pctFmt = pctGasto.toFixed(1).replace('.', ',');
      insight = `Você comprometeu <strong>${pctFmt}%</strong> do que faturou em ${_anualAno}. Melhor mês: <strong>${MESES_NOMES[melhorMes]}</strong>, com ${_anualFmt(melhorSaldo)} de sobra.`;
    }

  } else if (heroi === 'faturado') {
    const media = mesesComDado > 0 ? totalFaturado / mesesComDado : 0;
    let maiorMes = -1, maiorVal = -Infinity;
    for (let i = 0; i < 12; i++) {
      if (faturadoPorMes[i] > maiorVal) { maiorVal = faturadoPorMes[i]; maiorMes = i; }
    }
    if (maiorMes >= 0 && maiorVal > 0) {
      insight = `Média mensal de <strong>${_anualFmt(media)}</strong>. Mês de maior entrada: <strong>${MESES_NOMES[maiorMes]}</strong>, com ${_anualFmt(maiorVal)}.`;
    }

  } else if (heroi === 'gastos') {
    const mesesComGasto = gastosPorMes.filter(v => v > 0).length;
    const media = mesesComGasto > 0 ? totalGastos / mesesComGasto : 0;
    let maiorMes = -1, maiorVal = -Infinity;
    for (let i = 0; i < 12; i++) {
      if (gastosPorMes[i] > maiorVal) { maiorVal = gastosPorMes[i]; maiorMes = i; }
    }
    if (maiorMes >= 0 && maiorVal > 0) {
      insight = `Média mensal de <strong>${_anualFmt(media)}</strong> em gastos. Mês mais pesado: <strong>${MESES_NOMES[maiorMes]}</strong>, com ${_anualFmt(maiorVal)}.`;
    } else {
      row.style.display = 'none'; return;
    }

  } else if (heroi === 'reserva') {
    const totalReserva = (reservaPorMes || []).reduce((a, b) => a + b, 0);
    const mesesComDeposito = (reservaPorMes || []).filter(v => v > 0).length;
    if (totalReserva <= 0) {
      insight = `Nenhum depósito na reserva registrado em ${_anualAno}.`;
    } else {
      const pctReserva = totalFaturado > 0 ? ((totalReserva / totalFaturado) * 100).toFixed(1).replace('.', ',') : null;
      const parte1 = pctReserva ? `Você guardou <strong>${pctReserva}%</strong> do que faturou.` : `Total guardado em ${_anualAno}:`;
      const mesesLabel = mesesComDeposito === 1 ? '1 mês com depósito' : `${mesesComDeposito} meses com depósito`;
      insight = `${parte1} ${mesesLabel}, somando <strong>${_anualFmt(totalReserva)}</strong>.`;
    }
  }

  textoEl.innerHTML = insight;
}

function anualFecharPopup() {
  const overlay = document.getElementById('anual-popup-overlay');
  const popup   = document.getElementById('anual-popup');
  popup.style.opacity   = '0';
  popup.style.transform = 'translate(-50%,-50%) scale(0.95)';
  popup.style.pointerEvents = 'none';
  setTimeout(() => {
    popup.style.display   = 'none';
    overlay.style.display = 'none';
  }, 220);
}

function anualToggleWidget(id) {
  const widget = document.getElementById('widget-' + id);
  if (!widget) return;
  widget.classList.toggle('aberto');
}
/* ══════════════════════════════════════════════════════════════════════
 *  ATALHOS DE TECLADO
 *  ← / →  : navegar entre meses (só na página Mensal)
 *  Esc    : fechar o popup mais recente aberto
 *  Ctrl+Z : desfazer última edição de campo
 *  Ctrl+Y : refazer (após Ctrl+Z)
 * ══════════════════════════════════════════════════════════════════════ */

/* ── Undo / Redo ─────────────────────────────────────────────────────
 *  Pilha de snapshots do estado completo do mês.
 *  Cada entrada é { chave, dados } — mesmo formato do localStorage.
 *  Snapshot é tirado ANTES de cada alteração pelo usuário.
 * ─────────────────────────────────────────────────────────────────── */
const _undoStack = [];   // pilha de estados anteriores
const _redoStack = [];   // pilha de estados "futuros" (após undo)
const _UNDO_MAX  = 30;   // limite de profundidade

function _undoSnapshot() {
  if (mesFechado(anoAtual, indice)) return;
  const chave = 'planejamento_' + anoAtual + '_' + indice;
  const raw   = localStorage.getItem(chave);
  const snap  = { chave, dados: raw ? JSON.parse(raw) : {} };
  _undoStack.push(snap);
  if (_undoStack.length > _UNDO_MAX) _undoStack.shift();
  _redoStack.length = 0; // qualquer nova edição limpa o redo
}

function _undoAplicar(snap) {
  if (!snap) return;
  localStorage.setItem(snap.chave, JSON.stringify(snap.dados));
  carregarMes();
  recalc();
}

function _undo() {
  if (mesFechado(anoAtual, indice)) return;
  if (!_undoStack.length) return;
  // Salva estado atual no redo antes de desfazer
  const chave   = 'planejamento_' + anoAtual + '_' + indice;
  const raw     = localStorage.getItem(chave);
  _redoStack.push({ chave, dados: raw ? JSON.parse(raw) : {} });
  const snap = _undoStack.pop();
  _undoAplicar(snap);
  toastLimite('↩ Desfeito');
}

function _redo() {
  if (mesFechado(anoAtual, indice)) return;
  if (!_redoStack.length) return;
  const chave = 'planejamento_' + anoAtual + '_' + indice;
  const raw   = localStorage.getItem(chave);
  _undoStack.push({ chave, dados: raw ? JSON.parse(raw) : {} });
  const snap = _redoStack.pop();
  _undoAplicar(snap);
  toastLimite('↪ Refeito');
}

/* ── Captura snapshot antes de cada edição nos campos ──────────────── */
document.addEventListener('focus', function(e) {
  const el = e.target;
  if (!el) return;
  if (el.classList.contains('val-input') ||
      el.classList.contains('cat-input')  ||
      (el.tagName === 'SELECT' && el.closest('.bloco-wrap')) ||
      el.id === 'sal1' || el.id === 'sal2') {
    _undoSnapshot();
  }
}, true);

/* ── Lista de todos os overlays/popups para o Esc ─────────────────── */
const _ESC_POPUPS = [
  // overlay id            , função fechar
  ['anual-popup-overlay'           , () => anualFecharPopup()           ],
  ['popup-resumo-mes-overlay'      , () => fecharPopupResumoMes()       ],
  ['popup-fechar-mes-overlay'      , () => fecharPopupFecharMes()       ],
  ['popup-reabrir-mes-overlay'     , () => fecharPopupReabrirMes()      ],
  ['popup-movimento-overlay'       , () => fecharPopupMovimento()       ],
  ['popup-meta-overlay'            , () => fecharPopupMeta()            ],
  ['popup-cobrir-overlay'          , () => fecharPopupCobrir()          ],
  ['popup-subcategoria-overlay'    , () => fecharPopupSubcategoria()    ],
  ['popup-replicar-overlay'        , () => fecharPopupReplicar()        ],
  ['popup-conflito-overlay'        , () => fecharPopupConflito()        ],
  ['popup-apagar-parcelas-overlay' , () => fecharPopupApagarParcelas()  ],
  ['popup-replicar-mes-overlay'    , () => fecharPopupReplicarMes()     ],
  ['popup-replicar-sal-overlay'    , () => fecharPopupReplicarSal()     ],
  ['popup-diario-overlay'          , () => fecharPopupDiario()          ],
  ['popup-diario-excluir-overlay'  , () => fecharPopupDiarioExcluir()   ],
  ['popup-categorias-overlay'      , () => fecharPopupCategorias()      ],
  ['popup-config-overlay'          , () => fecharConfig()               ],
  ['popup-alterar-salario-overlay' , () => fecharPopupAlterarSalario()  ],
  ['popup-simulador-overlay'       , () => fecharSimuladorAnual()       ],
  ['popup-importar-overlay'        , () => _fecharPopupImportar()       ],
  ['popup-excluir-meta-overlay'    , () => fecharPopupConfirmarExcluirMeta() ],
];

function _fecharPopupTopoEsc() {
  // Fecha o popup visível de maior z-index (último da lista que estiver visível)
  for (let i = _ESC_POPUPS.length - 1; i >= 0; i--) {
    const [id, fn] = _ESC_POPUPS[i];
    const el = document.getElementById(id);
    if (el && (el.style.display === 'block' || el.classList.contains('visivel'))) {
      fn();
      return true;
    }
  }
  // Tour aberto?
  const tourOverlay = document.getElementById('tour-overlay');
  if (tourOverlay && tourOverlay.style.display !== 'none') {
    tourPular(); return true;
  }
  // Menu de dados aberto?
  const dadosMenu = document.getElementById('dados-menu');
  if (dadosMenu && dadosMenu.classList.contains('visivel')) {
    fecharDadosMenu(); return true;
  }
  return false;
}

/* ── Listener global de teclado ────────────────────────────────────── */
document.addEventListener('keydown', function(e) {
  const tag     = document.activeElement ? document.activeElement.tagName : '';
  const emInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  const ctrl    = e.ctrlKey || e.metaKey;

  // ── Ctrl+Z / Ctrl+Y ─────────────────────────────────────────────
  if (ctrl && (e.key === 'z' || e.key === 'y' || e.key === 'Y')) {
    const ativo = document.activeElement;
    const emCampoPlano = ativo && (
      ativo.classList.contains('val-input') ||
      ativo.classList.contains('cat-input') ||
      ativo.id === 'sal1' || ativo.id === 'sal2' ||
      (ativo.tagName === 'SELECT' && ativo.closest('.bloco-wrap'))
    );
    // Se estiver em campo do planejamento, usa undo/redo do sistema
    if (emCampoPlano || (!emInput && e.key === 'z')) {
      e.preventDefault();
      if (e.key === 'z') _undo(); else _redo();
    }
    // Caso contrário, deixa o undo nativo do browser funcionar
    return;
  }

  // ── Esc ─────────────────────────────────────────────────────────
  if (e.key === 'Escape') {
    _fecharPopupTopoEsc();
    return;
  }

  // ── ← / → : navegar meses (só Mensal, sem popup aberto, sem input focado) ──
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (emInput) return;
    if (ctrl)    return;
    // Só na página mensal
    const naDiario = document.getElementById('view-diario') &&
                     document.getElementById('view-diario').style.display !== 'none';
    const naAnual  = document.getElementById('view-anual') &&
                     document.getElementById('view-anual').style.display !== 'none';
    if (naDiario || naAnual) return;
    // Não age se houver qualquer overlay/popup visível
    const algumPopup = _ESC_POPUPS.some(function([id]) {
      const el = document.getElementById(id);
      if (!el) return false;
      return el.style.display === 'block' || el.classList.contains('visivel');
    });
    if (algumPopup) return;
    e.preventDefault();
    changeMonth(e.key === 'ArrowLeft' ? -1 : 1);
  }
});