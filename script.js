/* ── MULTI-META: declarações (antes de qualquer uso) ── */
const _META_KEYS = ["reserva_meta_v2", "reserva_meta_v2_b", "reserva_meta_v2_c"];
const _META_MAX  = 3;
let   _metaIdx   = 0;

/* ── BOTÕES X NAS LINHAS ── */
function atualizarLinhaPaga(linha) {
  const chk = linha.querySelector("input[type=checkbox]");
  if (chk) linha.classList.toggle("paga", chk.checked);
}

function adicionarBotoesLimpar() {
  document.querySelectorAll(".linha").forEach(linha => {
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
  });
}

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

/* ── REPLICAR NOS PRÓXIMOS MESES ── */
let _replicarLinha = null;
let _replicarParcelas = 0;

function getLinhaBlocoIndex(linha) {
  // Retorna { bwIdx, lIdx } para identificar a linha no localStorage
  let bwIdx = -1, lIdx = -1;
  document.querySelectorAll(".bloco-wrap").forEach((bw, bi) => {
    bw.querySelectorAll(".linha").forEach((l, li) => {
      if (l === linha) { bwIdx = bi; lIdx = li; }
    });
  });
  return { bwIdx, lIdx };
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

/* ── CORES DOS BANCOS NOS SELECTS DE CARTÃO ── */
const coresBancos = {
  "Nubank":         { bg: "#8A05BE", color: "#fff" },
  "Itaú":           { bg: "#EC7000", color: "#fff" },
  "Picpay":         { bg: "#11C76F", color: "#fff" },
  "Bradesco":       { bg: "#CC0000", color: "#fff" },
  "Santander":      { bg: "#EC0000", color: "#fff" },
  "C6 Bank":        { bg: "#1A1A1A", color: "#F0C020" },
  "Inter":          { bg: "#FF6B00", color: "#fff" },
  "Caixa":          { bg: "#005CA9", color: "#fff" },
  "Banco do Brasil":{ bg: "#F8D100", color: "#003087" },
  "Mercado Pago":   { bg: "#009EE3", color: "#fff" },
  "PagBank":        { bg: "#F5A800", color: "#fff" },
  "Banco PAN":      { bg: "#034EA2", color: "#fff" },
  "BTG Pactual":    { bg: "#1C1C1C", color: "#C9A84C" },
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
  document.querySelectorAll(".bloco-wrap").forEach(bw => {
    const titulo = bw.querySelector("h3");
    if (!titulo) return;
    const isCartao = titulo.textContent.trim().toLowerCase().includes("cart");
    if (!isCartao) return;
    bw.querySelectorAll("select").forEach(sel => {
      aplicarCorBanco(sel);
      sel.addEventListener("change", () => aplicarCorBanco(sel));
    });
  });
}


/* ── DROPDOWN CUSTOMIZADO BANCOS ── */
const bancosResidencia = ["Selecione","Internet","Água","Energia","Aluguel","Financiamento","Condomínio","IPTU"];
const bancosCartao = ["Selecione","Banco do Brasil","Banco PAN","Bradesco","BTG Pactual","C6 Bank","Caixa","Inter","Itaú","Mercado Pago","Nubank","Original","PagBank","Picpay","Santander","Sicredi"];

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
  const listaOpcoes = blocoTitulo.includes("resid") ? bancosResidencia : bancosCartao;

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

function aplicarCorBancoDisplay(display, valor) {
  const cor = coresBancos[valor];
  const clearBtn = display._clearBtn;
  if (cor) {
    display.style.background = cor.bg;
    display.style.color = cor.color;
    display.style.borderColor = cor.bg;
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
    }
    if (clearBtn) clearBtn.style.color = "#cc0000";
    atualizarDisplayVazio(display, valor);
  }
}

function inicializarCoresBancos() {
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

  // Rastreia o valor sacado como cobertura (não mexe no mov_previsao — ajuste de previsão de saldo)
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

/* ── POPUP ALTERAR SALÁRIO COM DEPÓSITO NO MÊS ── */
let _alterarSalarioPendente = false;
let _salarioAnterior = { sal1: "", sal2: "" };

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
  }

  recalc(true, true);
}

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
  // Restaura os valores anteriores na tela para que o cancelamento não deixe campos errados
  if (_salarioAnterior.sal1 !== undefined) {
    document.getElementById("sal1").value = _salarioAnterior.sal1;
    document.getElementById("sal2").value = _salarioAnterior.sal2;
    _salarioAnterior = { sal1: "", sal2: "" };
    recalc();
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
  _salarioAnterior = { sal1: "", sal2: "" }; // limpa sem restaurar
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
  _fecharPopupAlterarSalarioSemRestaurar();

  const chaveAdj = "mov_previsao_" + anoAtual + "_" + indice;

  // Reverte depósitos manuais da reserva deste mês
  {
    const reserva = carregarSaldoReserva();
    const movsFiltrados = (reserva.movimentos || []).filter(m =>
      !(m.ano === anoAtual && m.mes === indice && m.acao === "depositar" && !m.origem)
    );
    if (movsFiltrados.length !== (reserva.movimentos || []).length) {
      reserva.movimentos = movsFiltrados;
      reserva.saldo = calcularSaldoAteMes(reserva.movimentos, anoAtual, indice);
      salvarSaldoReserva(reserva);
      atualizarDisplayReserva();
      localStorage.setItem("dep_reserva_" + anoAtual + "_" + indice, "0");
    }
  }

  // Reverte depósitos manuais de cada slot de meta deste mês
  _META_KEYS.forEach((chaveLS, slotIdx) => {
    const metaSlot = carregarDadosMeta(slotIdx);
    if (!metaSlot) return;
    const movsFiltrados = (metaSlot.movimentos || []).filter(m =>
      !(m.ano === anoAtual && m.mes === indice && m.acao === "depositar" && !m.origem)
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

  _executarAlteracaoSalario();
}

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
    item.style.cssText = "padding:7px 18px;font-size:12px;font-family:inherit;cursor:pointer;background:#fff;color:#1a2a5e;text-align:center;white-space:nowrap;transition:background 0.1s,color 0.1s;";
    if (ano === anoAtual) { item.style.background = "#e8effe"; item.style.fontWeight = "700"; item.style.color = "#1c3f91"; }
    item.textContent = ano;
    item.addEventListener("mouseenter", () => { if (ano !== anoAtual) { item.style.background = "#eef3fd"; item.style.color = "#1c3f91"; } });
    item.addEventListener("mouseleave", () => { if (ano !== anoAtual) { item.style.background = "#fff"; item.style.color = "#1a2a5e"; } });
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
    item.className = "mes-dropdown-item" + (i === indice ? " ativo" : "");
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
  lista.querySelectorAll(".mes-dropdown-item").forEach((el, i) => {
    el.classList.toggle("ativo", i === indice);
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

/* ── SALVA dados do mês atual no LocalStorage ── */
function salvarMes() {
  if (mesFechado(anoAtual, indice)) return; // mês fechado — não permite alteração
  if (_indiceVisual !== null) return;        // tela em transição — campos foram limpos, não salva
  const chave = "planejamento_" + anoAtual + "_" + indice;
  const dados = {};

  dados.sal1 = document.getElementById("sal1").value;
  dados.sal2 = document.getElementById("sal2").value;

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
  document.querySelectorAll(".linha select").forEach(s => s.value = "");
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

let _movimentoMax = Infinity;

function fmtMax(input) {
  fmtInput(input);
  const v = num(input.value);
  if (_movimentoMax < Infinity && v > _movimentoMax) {
    input.value = brl(_movimentoMax);
  }
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
  document.getElementById("sub1").textContent = brl(sub1);
  document.getElementById("sub2").textContent = brl(sub2);

  const sal1 = num(document.getElementById("sal1").value);
  const sal2 = num(document.getElementById("sal2").value);
  const totalSal = sal1 + sal2;
  document.getElementById("sal-total").value = totalSal > 0 ? brl(totalSal) : "";

  // Atualiza barra de progresso dos subtotais
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
  _atualizarProgressoSubtotal("sub1-ring", sub1, sal1);
  _atualizarProgressoSubtotal("sub2-ring", sub2, sal2);

  const totalGastos    = sub1 + sub2;
  const chaveAdj       = "mov_previsao_"  + anoAtual + "_" + indice;
  const chaveCobertura = "cobrir_valor_"  + anoAtual + "_" + indice;
  const coberturaTotal = parseFloat(localStorage.getItem(chaveCobertura) || "0");

  // ajuste = depósitos/retiradas manuais na reserva/meta (mov_previsao)
  const ajuste = parseFloat(localStorage.getItem(chaveAdj) || "0");
  const deficitReal = totalSal - totalGastos - ajuste;

  // Se há cobertura ativa e o déficit real diminuiu, reverte o excedente
  if (coberturaTotal > 0) {
    // deficitReal já inclui o ajuste (depósitos na reserva/meta)
    // cobertura necessária = quanto ainda falta cobrir (se déficit ainda negativo)
    const coberturaNecessaria = Math.max(0, -deficitReal);
    const coberturaExcedente = coberturaTotal - coberturaNecessaria;
    if (coberturaExcedente > 0.004) {
      _reverterCoberturaParcial(coberturaExcedente);
    }
  }

  // coberturaTotal atualizado após possível reversão parcial acima
  const coberturaAtual = parseFloat(localStorage.getItem(chaveCobertura) || "0");
  const cobEfetiva = deficitReal < 0 ? Math.min(coberturaAtual, Math.abs(deficitReal)) : 0;
  const previsaoSaldo = deficitReal + cobEfetiva;
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
  if (totalSal > 0 && previsaoSaldo < -0.005) {
    if (fromSalary) exibirToastAviso(true);
    else exibirPopupAviso();
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


/* ── RESERVA DE EMERGÊNCIA — SALDO ACUMULADO ── */

function carregarSaldoReserva() {
  const raw = localStorage.getItem("reserva_saldo_v1");
  return raw ? JSON.parse(raw) : { saldo: 0, movimentos: [] };
}

function salvarSaldoReserva(dados) {
  localStorage.setItem("reserva_saldo_v1", JSON.stringify(dados));
}

function calcularSaldoAteMes(movimentos, ano, mes) {
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
}

/* ── POPUP MOVIMENTO (depositar / retirar) ── */
let _movimentoTipo   = ""; // 'reserva' ou 'meta'
let _movimentoAcao   = ""; // 'depositar' ou 'retirar'

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
  toast.style.cssText = "position:fixed;right:20px;z-index:10002;background:#fff;border-radius:10px;" +
    "box-shadow:0 4px 20px rgba(0,0,0,0.18),0 0 0 1px rgba(231,76,60,0.15);" +
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
      exibirToastSaldo(`O saldo exibido da ${nomeCard} já foi utilizado em meses seguintes. Não há valor disponível para saque neste mês.`);
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
    if (maxEl) { maxEl.textContent = `Valor máximo: ${brl(saldoDisponivel)}`; maxEl.style.display = "block"; }
  }

  // Mostra botão "Sacar tudo" apenas ao retirar
  const btnSacarTudo     = document.getElementById("popup-movimento-sacar-tudo");
  const btnDepositarTudo = document.getElementById("popup-movimento-depositar-tudo");
  if (btnSacarTudo)     btnSacarTudo.style.display     = (acao === "retirar")  ? "inline-block" : "none";
  if (btnDepositarTudo) btnDepositarTudo.style.display  = (acao === "depositar") ? "inline-block" : "none";

  const overlay = document.getElementById("popup-movimento-overlay");
  const popup   = document.getElementById("popup-movimento");
  overlay.style.display = "block";
  popup.style.display   = "block";
  requestAnimationFrame(() => {
    popup.style.opacity       = "1";
    popup.style.transform     = "translate(-50%,-50%) scale(1)";
    popup.style.pointerEvents = "auto";
    setTimeout(() => document.getElementById("popup-movimento-valor").focus(), 150);
  });
}

function sacarTudo() {
  if (_movimentoMax <= 0) return;
  const inp = document.getElementById("popup-movimento-valor");
  if (!inp) return;
  inp.value = brl(_movimentoMax);
  inp.dispatchEvent(new Event("input"));
  inp.style.borderColor = "#e74c3c";
  setTimeout(() => inp.style.borderColor = "", 800);
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
      salvarDadosMeta(dados.valor, dados.mes, dados.ano, dados.categoria, dados.saldoAcumulado, dados.movimentos);
    }
    atualizarBarraReserva();
  }

  fecharPopupMovimento();
  const sinal = (_movimentoAcao === "depositar") ? valor : -valor;
  aplicarMovimentoPrevisao(sinal);
  salvarMes();
  recalc();
}

// Armazena o ajuste do mês atual para o cálculo da previsão de saldo
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

  // Salva registro de exclusão para exibir a meta como "fantasma" em meses anteriores
  if (dados) {
    const _NM = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                 "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    localStorage.setItem("meta_excluida_v2_" + _metaIdx, JSON.stringify({
      ...dados,
      excluidoAno: anoAtual,
      excluidoMes: indice,
      excluidoLabel: _NM[indice - 1] + "/" + anoAtual
    }));
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

  // Metas excluídas: aparecem apenas em meses ANTERIORES ao da exclusão
  const excluidas = [0, 1, 2].map(i => {
    const raw = localStorage.getItem("meta_excluida_v2_" + i);
    if (!raw) return null;
    const d = JSON.parse(raw);
    // Só exibe se o mês visualizado é anterior ao mês de exclusão
    const anteriorAoCorte = anoAtual < d.excluidoAno ||
      (anoAtual === d.excluidoAno && indice < d.excluidoMes);
    if (!anteriorAoCorte) return null;
    // Não duplicar se já existe ativa (não deveria, mas por segurança)
    if (ativas.some(a => a.idx === i)) return null;
    return { idx: i, dados: d, excluida: true };
  }).filter(Boolean);

  return [...ativas, ...excluidas];
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

  // Garante que _metaIdx aponta para um slot com dados (ativo ou excluído visível)
  if (!lista.find(m => m.idx === _metaIdx)) {
    _metaIdx = lista[0].idx;
  }

  const d   = carregarDadosMeta(_metaIdx) || lista.find(m => m.idx === _metaIdx)?.dados;
  const tot = lista.length;
  // posição visual (0-based) dentro da lista preenchida
  const pos = lista.findIndex(m => m.idx === _metaIdx);

  // Badge sutil de "excluída" — aparece apenas quando estamos em mês anterior à exclusão
  const itemAtivo  = lista.find(m => m.idx === _metaIdx);
  const foiExcluida = itemAtivo?.excluida === true;
  let badgeExcluida = document.getElementById("meta-badge-excluida");
  const cardPrincipal = document.getElementById("meta-card-principal");
  if (foiExcluida && d?.excluidoLabel) {
    if (!badgeExcluida) {
      badgeExcluida = document.createElement("div");
      badgeExcluida.id = "meta-badge-excluida";
      badgeExcluida.style.cssText = [
        "position:absolute", "top:10px", "right:10px",
        "background:rgba(0,0,0,0.38)", "color:rgba(255,255,255,0.72)",
        "font-size:9.5px", "font-weight:600", "letter-spacing:0.3px",
        "padding:3px 7px", "border-radius:20px",
        "font-family:Outfit,sans-serif", "pointer-events:none",
        "backdrop-filter:blur(4px)", "z-index:5"
      ].join(";");
      if (cardPrincipal) {
        cardPrincipal.style.position = "relative";
        cardPrincipal.appendChild(badgeExcluida);
      }
    }
    badgeExcluida.textContent = "Excluída em " + d.excluidoLabel;
    badgeExcluida.style.display = "block";
  } else if (badgeExcluida) {
    badgeExcluida.style.display = "none";
  }

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

    let novosDados = Object.assign({}, dadosAtual);
    if (modo === "manter") {
      const raw = localStorage.getItem(chave);
      if (raw) {
        const dest = JSON.parse(raw);
        if (dest.sal1) novosDados.sal1 = dest.sal1;
        if (dest.sal2) novosDados.sal2 = dest.sal2;
      }
    }

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

window.addEventListener("DOMContentLoaded", function() {
  _migrarDatasCriacao();
  adicionarBotoesLimpar();
  inicializarCoresBancos();
  inicializarDropdownsMeta();
  carregarMes();
  carregarMetaReserva();
  atualizarBarraReserva();
  atualizarDisplayReserva();
  _inicializarIconePrevisao();
});

function _inicializarIconePrevisao() {
  const icone = document.getElementById("previsao-pct-info-icon");
  const tooltip = document.getElementById("previsao-pct-tooltip");
  if (!icone || !tooltip) return;

  // Popula o SVG do ícone
  icone.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8a9cc8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8" stroke-width="3"/><line x1="12" y1="12" x2="12" y2="16"/></svg>';

  // Hover com delay — JS fallback para :has() em browsers antigos
  let _timerIn, _timerOut;
  icone.addEventListener("mouseenter", () => {
    clearTimeout(_timerOut);
    _timerIn = setTimeout(() => {
      tooltip.style.opacity = "1";
      tooltip.style.visibility = "visible";
    }, 500);
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

let _configDiarioAberto  = false;
let _configDiarioPending = null; // estado temporário enquanto o popup está aberto
let _previsaoSaldoCache  = 0;    // cache do último valor calculado por recalc()

function abrirConfigDiario() {
  if (_configDiarioAberto) { fecharConfigDiario(); return; }
  _configDiarioAberto = true;

  // Captura o estado salvo como ponto de partida do estado pendente
  const { ativo } = getLimiteMensalDiario();
  _configDiarioPending = { ativo };

  const overlay = document.getElementById('popup-config-diario-overlay');
  const popup   = document.getElementById('popup-config-diario');
  if (overlay) { overlay.style.display = 'block'; }
  if (popup)   {
    popup.style.display = 'block';
    _sincronizarToggleLimiteDiario();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      popup.style.opacity   = '1';
      popup.style.transform = 'translateY(0) scale(1)';
      popup.style.pointerEvents = 'auto';
    }));
  }
}

function fecharConfigDiario() {
  // Descarta alterações pendentes — reverte para o estado salvo
  _configDiarioPending = null;
  _configDiarioAberto  = false;
  _sincronizarToggleLimiteDiario(); // restaura visual do toggle

  const overlay = document.getElementById('popup-config-diario-overlay');
  const popup   = document.getElementById('popup-config-diario');
  if (overlay) overlay.style.display = 'none';
  if (popup) {
    popup.style.opacity   = '0';
    popup.style.transform = 'translateY(14px) scale(0.96)';
    popup.style.pointerEvents = 'none';
    setTimeout(() => { popup.style.display = 'none'; }, 240);
  }
}

function salvarConfigDiario() {
  if (!_configDiarioPending) { fecharConfigDiario(); return; }
  // Persiste somente ao clicar Salvar
  localStorage.setItem(_CHAVE_LIMITE_DIARIO_ATIVO, JSON.stringify(_configDiarioPending.ativo));
  _configDiarioPending = null;
  // Garante que o DOM do Mensal está atualizado antes de renderizar o Diário
  carregarMes();
  fecharConfigDiario();
  exibirToastInfo('Configurações salvas.', 2500);
}

// ── LIMITE MENSAL PERSONALIZADO DO DIÁRIO ──────────────────────────────────
const _CHAVE_LIMITE_DIARIO_ATIVO = 'diario_limite_mensal_ativo';
const _CHAVE_LIMITE_DIARIO_VALOR = 'diario_limite_mensal_valor';

function getLimiteMensalDiario() {
  // Padrão: ativo = true (habilitado por padrão)
  const raw = localStorage.getItem(_CHAVE_LIMITE_DIARIO_ATIVO);
  const ativo = raw === null ? true : JSON.parse(raw);
  const valor = parseFloat(localStorage.getItem(_CHAVE_LIMITE_DIARIO_VALOR) || '0');
  return { ativo, valor };
}

function _sincronizarToggleLimiteDiario() {
  // Lê do estado pendente se o popup estiver aberto, caso contrário do localStorage
  const ativo = _configDiarioPending
    ? _configDiarioPending.ativo
    : getLimiteMensalDiario().ativo;

  const toggle = document.getElementById('diario-cfg-toggle');
  const knob   = document.getElementById('diario-cfg-toggle-knob');
  const lapis  = document.getElementById('diario-limite-lapis');

  if (toggle) {
    toggle.style.background = ativo ? '#3a6edc' : '#d0d8ea';
    if (knob) knob.style.left = ativo ? '19px' : '3px';
  }
  // Lápis visível apenas quando toggle está desligado (modo edição manual)
  if (lapis) lapis.style.display = !ativo ? 'inline-flex' : 'none';

  // Fecha o edit inline se ativou (modo automático não permite editar)
  if (ativo) cancelarEditeLimiteMensal();
}

function toggleLimiteMensalDiario() {
  // Altera apenas o estado pendente — não grava no localStorage até Salvar
  if (_configDiarioPending) {
    _configDiarioPending.ativo = !_configDiarioPending.ativo;
  }
  _sincronizarToggleLimiteDiario();
  // Não chama renderizarDiario() aqui — o efeito só ocorre ao salvar
}

// ── Edição inline do limite mensal (lápis no header do diário) ────────────
function abrirEditeLimiteMensal() {
  const input     = document.getElementById('diario-limite-mensal');
  const lapis     = document.getElementById('diario-limite-lapis');
  const confirmar = document.getElementById('diario-limite-confirmar');
  if (!input) return;

  input.readOnly = false;
  input.classList.add('editando');
  if (lapis)     lapis.style.display     = 'none';
  if (confirmar) confirmar.style.display = 'inline-flex';

  const len = input.value.length;
  input.focus();
  input.setSelectionRange(len, len);
}

function confirmarEditeLimiteMensal() {
  const input     = document.getElementById('diario-limite-mensal');
  const lapis     = document.getElementById('diario-limite-lapis');
  const confirmar = document.getElementById('diario-limite-confirmar');
  if (!input || !input.classList.contains('editando')) return;

  const valor = num(input.value);
  if (valor <= 0) {
    input.style.borderBottomColor = '#e74c3c';
    input.style.color = '#e74c3c';
    setTimeout(() => { input.style.borderBottomColor = ''; input.style.color = ''; }, 1400);
    return;
  }

  localStorage.setItem(_CHAVE_LIMITE_DIARIO_VALOR, String(valor));
  input.readOnly = true;
  input.classList.remove('editando');
  if (confirmar) confirmar.style.display = 'none';
  const { ativo } = getLimiteMensalDiario();
  if (lapis) lapis.style.display = !ativo ? 'inline-flex' : 'none';
  renderizarDiario();
}

function cancelarEditeLimiteMensal() {
  const input     = document.getElementById('diario-limite-mensal');
  const lapis     = document.getElementById('diario-limite-lapis');
  const confirmar = document.getElementById('diario-limite-confirmar');
  if (!input) return;

  input.readOnly = true;
  input.classList.remove('editando');
  input.style.borderBottomColor = '';
  input.style.color = '';
  if (confirmar) confirmar.style.display = 'none';
  const { ativo } = getLimiteMensalDiario();
  if (lapis) lapis.style.display = !ativo ? 'inline-flex' : 'none';
  // Não chama renderizarDiario() aqui — evita recursão via _sincronizarToggleLimiteDiario
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
    thumbCor.style.left = (_alertaPrevisaoAtivo && _alertaCorAtivo) ? "24px" : "4px";
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
    // Toast sempre que o pai estiver ativo
    if (!_alertaPrevisaoJaDisparado) {
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
    btnFch.title = fechado ? "Reabrir fechamento contábil" : "Fechamento contábil";
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
  // Detecta qual aba está ativa para o botão "Iniciar tour" chamar a função certa
  const isDiario = document.getElementById('view-diario') &&
                   document.getElementById('view-diario').style.display !== 'none';
  const btnIniciar = popup.querySelector('.btn-iniciar-tour');
  if (btnIniciar) {
    btnIniciar.onclick = function() {
      fecharPopupTour();
      if (isDiario) iniciarTourDiario(); else iniciarTour();
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

  exibirToastInfo(meses[indice] + " fechado. Edições bloqueadas.", 5000);
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

/* ── EXPORTAR / IMPORTAR DADOS ── */

function exportarDados() {
  // Garante que edições em tela (ainda no debounce) sejam gravadas antes de exportar
  clearTimeout(_salvoDebounce);
  salvarMes();

  const prefixos = [
    'planejamento_', // aba 'Mensal' na UI
    'mov_previsao_',
    'cobrir_valor_',
    'dep_reserva_',
    'dep_meta_',
    'cobrir_previsao_',
    'mes_fechado_',
    'diario_',            // aba Diário: lançamentos diários + limites (diario_limite_mensal_*)
    'simulador_reserva_', // simulador de reserva por ano
  ];
  const chavesFixas = [
    'reserva_saldo_v1',
    'reserva_meta_v2',
    'reserva_meta_v2_b',
    'reserva_meta_v2_c',
    'meta_excluida_v2_0',
    'meta_excluida_v2_1',
    'meta_excluida_v2_2',
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
    'dep_meta_', 'cobrir_previsao_', 'mes_fechado_', 'diario_', 'simulador_reserva_',
  ];
  const chavesFixasApp = [
    'reserva_saldo_v1', 'reserva_meta_v2', 'reserva_meta_v2_b', 'reserva_meta_v2_c',
    'meta_excluida_v2_0', 'meta_excluida_v2_1', 'meta_excluida_v2_2',
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
function mudarAba(aba) {
  // Salva imediatamente antes de trocar — evita perder edições pendentes no debounce
  clearTimeout(_salvoDebounce);
  salvarMes();

  const elMes          = document.getElementById('view-mes-container');
  const elBanner       = document.getElementById('mes-fechado-banner');
  const elLayout       = document.getElementById('view-main-layout');
  const elDiario       = document.getElementById('view-diario');
  const fabMensal      = document.getElementById('fab-mensal');
  const fabDiario      = document.getElementById('fab-diario');
  const tabP           = document.getElementById('tab-planejamento');
  const tabD           = document.getElementById('tab-diario');

  if (aba === 'diario') {
    if (elMes)     elMes.style.display    = 'none';
    if (elBanner)  elBanner.style.display = 'none';
    if (elLayout)  elLayout.style.display = 'none';
    if (fabMensal) fabMensal.style.display = 'none';
    if (elDiario)  elDiario.style.display = 'block';
    if (fabDiario) fabDiario.style.display = 'flex';
    tabP.classList.remove('ativo');
    tabD.classList.add('ativo');
    carregarMes(); // recalc() atualiza _previsaoSaldoCache, depois chama renderizarDiario()
  } else {
    if (elMes)     elMes.style.display    = 'flex';
    if (elLayout)  elLayout.style.display = 'flex';
    if (fabMensal) fabMensal.style.display = 'flex';
    if (elDiario)  elDiario.style.display = 'none';
    if (fabDiario) fabDiario.style.display = 'none';
    if (elBanner)  elBanner.style.display = '';
    tabP.classList.add('ativo');
    tabD.classList.remove('ativo');
    carregarMes(); // recarrega os campos do Mensal que foram limpos ao entrar no Diário
  }
}

function getDiasNoMes(ano, mes) {
  return new Date(ano, mes + 1, 0).getDate();
}

function formatarDataDiario(ano, mes, dia) {
  const d = String(dia).padStart(2,'0');
  const m = String(mes + 1).padStart(2,'0');
  return `${d}/${m}/${ano}`;
}

function chaveDiario(ano, mes, dia) {
  return `diario_${ano}_${mes}_${dia}`;
}

function salvarDiario(ano, mes, dia, saida, banco) {
  const chave = chaveDiario(ano, mes, dia);
  localStorage.setItem(chave, JSON.stringify({ saida, banco }));
}

function carregarDiario(ano, mes, dia) {
  const chave = chaveDiario(ano, mes, dia);
  const raw = localStorage.getItem(chave);
  return raw ? JSON.parse(raw) : { saida: '', banco: '' };
}

function renderizarDiario() {
  // Usa o cache atualizado por recalc() — nunca lê DOM que pode estar oculto
  const previsaoSaldo = _previsaoSaldoCache;

  // Limite mensal: se toggle desativado e valor salvo > 0, usa o personalizado; senão usa previsão
  const cfgLimite = getLimiteMensalDiario();
  const limiteMensal = !cfgLimite.ativo && cfgLimite.valor > 0
    ? cfgLimite.valor
    : (previsaoSaldo > 0 ? previsaoSaldo : 0);

  const dias = getDiasNoMes(anoAtual, indice);
  const limiteDiario = dias > 0 ? limiteMensal / dias : 0;

  // Atualiza título com mês e ano
  const elMesTitulo = document.getElementById('diario-mes-titulo');
  if (elMesTitulo) elMesTitulo.textContent = `— ${meses[indice]} ${anoAtual}`;

  // Dia atual
  const hoje = new Date();
  const diaHoje = (hoje.getFullYear() === anoAtual && hoje.getMonth() === indice) ? hoje.getDate() : -1;

  const tbodyEsq = document.getElementById('diario-tbody-esq');
  const tbodyDir = document.getElementById('diario-tbody-dir');
  tbodyEsq.innerHTML = '';
  tbodyDir.innerHTML = '';

  const metade = Math.ceil(dias / 2);

  let dispAcum = 0;
  let totalSaidaEsq = 0;
  let totalSaidaDir = 0;
  let dispFinalEsq = 0;
  let dispFinalDir = 0;

  // Pré-calcula tudo para disponível acumulado correto
  const linhas = [];
  for (let d = 1; d <= dias; d++) {
    const dado = carregarDiario(anoAtual, indice, d);
    const saidaVal = dado.saida ? num(dado.saida) : 0;
    dispAcum += limiteDiario - saidaVal;
    linhas.push({ d, dado, saidaVal, dispAcum });
  }

  document.getElementById('diario-limite-mensal').value = brl(limiteMensal);
  document.getElementById('diario-limite-diario').textContent = brl(limiteDiario);

  // Garante visibilidade do lápis conforme estado do toggle
  _sincronizarToggleLimiteDiario();

  const diarioBloqueado = mesFechado(anoAtual, indice);
  const banner = document.getElementById('diario-banner-fechado');
  if (banner) { banner.classList.toggle('visivel', diarioBloqueado); }

  function criarLinha(item, tbody) {
    const { d, dado, saidaVal, dispAcum } = item;
    const tr = document.createElement('tr');
    if (d === diaHoje) tr.classList.add('diario-hoje');
    if (diarioBloqueado) tr.classList.add('diario-bloqueado');

    // Data
    const tdData = document.createElement('td');
    tdData.textContent = formatarDataDiario(anoAtual, indice, d);
    tr.appendChild(tdData);

    // Dia da semana
    const tdDiaSemana = document.createElement('td');
    const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const dataLinha = new Date(anoAtual, indice, d);
    tdDiaSemana.textContent = diasSemana[dataLinha.getDay()];
    tr.appendChild(tdDiaSemana);

    // Disponível
    const tdDisp = document.createElement('td');
    tdDisp.className = 'diario-td-disponivel' + (dispAcum < 0 ? ' negativo' : '');
    tdDisp.textContent = brl(dispAcum);
    tr.appendChild(tdDisp);

    // Saída
    const tdSaida = document.createElement('td');
    tdSaida.style.position = 'relative';
    const inputSaida = document.createElement('input');
    inputSaida.type = 'text';
    inputSaida.className = 'diario-saida-input';
    inputSaida.placeholder = 'R$ 0,00';
    inputSaida.autocomplete = 'off';
    if (dado.saida) inputSaida.value = dado.saida;
    inputSaida.dataset.dia = d;
    if (diarioBloqueado) {
      inputSaida.disabled = true;
      inputSaida.style.cursor = 'not-allowed';
      inputSaida.style.opacity = '0.6';
    }
    inputSaida.addEventListener('input', function() { fmtInput(this); });
    inputSaida.addEventListener('blur', function() {
      fmt(this);
      const dia = parseInt(this.dataset.dia);
      salvarDiario(anoAtual, indice, dia, this.value, '');
      renderizarDiario();
    });
    inputSaida.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') this.blur();
    });
    tdSaida.appendChild(inputSaida);

    // Botão X para limpar saída
    const btnLimpar = document.createElement('button');
    btnLimpar.className = 'btn-limpar-linha diario-limpar-saida';
    btnLimpar.textContent = '×';
    const tooltipLimpar = document.createElement('span');
    tooltipLimpar.className = 'limpar-tooltip';
    tooltipLimpar.textContent = 'Limpar saída';
    btnLimpar.appendChild(tooltipLimpar);
    btnLimpar.addEventListener('click', () => {
      inputSaida.value = '';
      salvarDiario(anoAtual, indice, d, '', '');
      renderizarDiario();
    });
    if (diarioBloqueado) btnLimpar.style.display = 'none';
    tdSaida.appendChild(btnLimpar);

    tr.appendChild(tdSaida);

    tbody.appendChild(tr);
  }

  linhas.forEach((item, i) => {
    if (i < metade) {
      criarLinha(item, tbodyEsq);
      totalSaidaEsq += item.saidaVal;
      dispFinalEsq = item.dispAcum;
    } else {
      criarLinha(item, tbodyDir);
      totalSaidaDir += item.saidaVal;
      dispFinalDir = item.dispAcum;
    }
  });

  const elDispEsq = document.getElementById('diario-total-disponivel-esq'); if (elDispEsq) elDispEsq.textContent = brl(dispFinalEsq);
  const elSaidaEsq = document.getElementById('diario-total-saida-esq'); if (elSaidaEsq) elSaidaEsq.textContent = brl(totalSaidaEsq);
  document.getElementById('diario-total-disponivel-dir').textContent  = brl(dispFinalDir);
  document.getElementById('diario-total-saida-dir').textContent       = brl(totalSaidaDir);
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
    td.style.cssText = 'position:relative;padding:4px 12px;text-align:center;';

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
    tr.onmouseover = () => tr.style.background = '#f5f8fd';
    tr.onmouseout  = () => tr.style.background = '';

    const tdMes = document.createElement('td');
    tdMes.textContent = mes;
    tdMes.style.cssText = 'padding:6px 12px;color:#1a2a5e;font-weight:600;font-size:12px;text-align:center;';

    const tdInicial = document.createElement('td');
    tdInicial.className = 'sim-cel-inicial';
    tdInicial.style.cssText = 'padding:6px 12px;text-align:center;color:#6a7aaa;font-weight:600;font-size:12px;';
    tdInicial.textContent = 'R$ 0,00';

    const tdEntrada = criarCelula('entrada', i, d.entrada);
    const tdSaida   = criarCelula('saida',   i, d.saida);

    const tdTotal = document.createElement('td');
    tdTotal.className = 'sim-cel-total';
    tdTotal.style.cssText = 'padding:6px 12px;text-align:center;font-weight:700;font-size:12.5px;color:#1f7a1f;font-family:Outfit,Century Gothic,sans-serif;';
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
  let _timer = null;
  document.querySelectorAll('.sim-thead-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const text = btn.dataset.simTooltip;
      const type = btn.dataset.simTooltipType;
      if (!text) return;
      tip.textContent = text;
      tip.className = type + ' show';
      // Não setar show ainda — aguardar delay
      tip.classList.remove('show');
      clearTimeout(_timer);
      _timer = setTimeout(() => {
        const r = btn.getBoundingClientRect();
        tip.style.left = (r.left + r.width / 2) + 'px';
        tip.style.top  = (r.top - 10) + 'px';
        tip.style.transform = 'translateX(-50%) translateY(-100%)';
        tip.classList.add('show');
      }, 500);
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

  // ── 1. SALÁRIO 1 ──
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

  // ── 14. PREVISÃO DE SALDO ──
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

  // ── 15. PREVISÃO DE GASTOS ──
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

  // ── 16. RESERVA DE EMERGÊNCIA ──
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

  // ── 17. SIMULAR RESERVA ──
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

  // ── 18. METAS FINANCEIRAS ──
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

  // ── 19. REPLICAR MÊS ──
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
/* ══════════════════════════════════════════════
   TOUR DIÁRIO
   ══════════════════════════════════════════════ */

const _tourPassosDiario = [

  // ── 1. LIMITES MENSAL E DIÁRIO ──
  {
    alvo: 'diario-info-card',
    titulo: 'Limites de gasto',
    desc: 'O limite mensal é o valor que aparece no campo “Previsão de Saldo”. O limite diário é esse valor dividido pelos dias do mês. Assim, você sabe quanto pode gastar por dia e consegue ver se vai terminar o mês dentro do planejado ou se vai precisar usar a reserva de emergência.',
    padT: 12, padR: 16, padB: 12, padL: 16,
    onEntrar: function() {
      const el = document.getElementById('diario-info-card');
      if (!el) return;
      el.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.35s';
      el.style.transform  = 'scale(1.04)';
      el.style.boxShadow  = '0 6px 24px rgba(28,63,145,0.18)';
      _tourTimeout(function() {
        el.style.transform = 'scale(1)';
        el.style.boxShadow = '';
      }, 500);
    },
    onSair: function() {
      _clearTourTimers();
      const el = document.getElementById('diario-info-card');
      if (el) { el.style.transition = ''; el.style.transform = ''; el.style.boxShadow = ''; }
    }
  },

  // ── 2. COLUNA DISPONÍVEL ──
  {
    alvo: 'diario-colunas',
    titulo: 'Coluna Disponível',
    desc: 'Mostra quanto você pode gastar no dia. Se não usar tudo, o valor restante passa para o dia seguinte e vai acumulando ao longo do mês. É um saldo diário que se ajusta ao seu ritmo de gastos.',
    _semHighlightInicial: true,
    onEntrar: function() {
      _tourIluminarColunaDiario(2, 0);
    },
    onSair: function() { _clearTourTimers(); }
  },

  // ── 3. COLUNA SAÍDA ──
  {
    alvo: 'diario-colunas',
    titulo: 'Coluna Saída',
    desc: 'Aqui você registra seus gastos do dia a dia, como mercado, transporte e lazer. Diferente do Mensal, que é para despesas fixas (como aluguel e cartões), a Saída é para os gastos variáveis do cotidiano.',
    _semHighlightInicial: true,
    onEntrar: function() {
      _tourIluminarColunaDiario(3, 0);
    },
    onSair: function() { _clearTourTimers(); }
  },
];

// Ilumina a coluna inteira (colIdx 0-based) nas duas tabelas do diário.
// Mede th → última linha do tbody/tfoot para um único retângulo por tabela.
// Posiciona o balão do lado direito das colunas iluminadas, alinhado ao centro vertical.
function _tourIluminarColunaDiario(colIdx, delay) {
  const svg  = document.getElementById('tour-overlay');
  const mask = svg.querySelector('#tour-mask');
  const ns   = 'http://www.w3.org/2000/svg';
  svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
  // Não esconde o balão aqui — ele permanece visível durante o delay e é reposicionado depois

  function executar() {
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

    const tables = document.querySelectorAll('.diario-table');
    const colRects = []; // um rect por tabela representando a coluna inteira

    tables.forEach(function(table) {
      const th = table.querySelectorAll('thead th')[colIdx];
      if (!th) return;

      // Linha mais baixa: tfoot td se existir, senão último tbody tr
      var bottomEl = null;
      const ftds = table.querySelectorAll('tfoot td');
      if (ftds.length > colIdx) {
        bottomEl = ftds[colIdx];
      } else {
        const tbodyRows = table.querySelectorAll('tbody tr');
        if (tbodyRows.length) {
          const lastRow = tbodyRows[tbodyRows.length - 1];
          const tds = lastRow.querySelectorAll('td');
          if (tds.length > colIdx) bottomEl = tds[colIdx];
        }
      }
      if (!bottomEl) bottomEl = th;

      const rTop    = th.getBoundingClientRect();
      const rBottom = bottomEl.getBoundingClientRect();

      const x = rTop.left    / z - 2;
      const y = rTop.top     / z - 2;
      const w = rTop.width   / z + 4;
      const h = rBottom.bottom / z - rTop.top / z + 4;

      colRects.push({ x, y, w, h });

      // Furo (transparência) — coluna inteira
      const hole = document.createElementNS(ns, 'rect');
      hole.setAttribute('x', x); hole.setAttribute('y', y);
      hole.setAttribute('width', w); hole.setAttribute('height', h);
      hole.setAttribute('rx', 6); hole.setAttribute('fill', 'black');
      hole.classList.add('tour-dyn');
      mask.appendChild(hole);

      // Borda azul ao redor da coluna inteira
      const border = document.createElementNS(ns, 'rect');
      border.setAttribute('x', x); border.setAttribute('y', y);
      border.setAttribute('width', w); border.setAttribute('height', h);
      border.setAttribute('rx', 6);
      border.setAttribute('fill', 'none');
      border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
      border.setAttribute('stroke-width', '2.5');
      border.classList.add('tour-dyn');
      svg.appendChild(border);
    });

    if (!colRects.length) { _mostrarBalao(); return; }

    // Posiciona o balão à direita das colunas iluminadas, centrado verticalmente
    _tourPosicionarBalaoColunaDiario(colRects);
  }

  if (delay > 0) {
    _tourTimeout(executar, delay);
  } else {
    executar();
  }
}

// Posiciona o balão à direita das colunas, ou abaixo se não couber
function _tourPosicionarBalaoColunaDiario(colRects) {
  const balao = document.getElementById('tour-balao');
  if (!balao) return;
  const z   = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const vW  = window.innerWidth  / z;
  const vH  = window.innerHeight / z;
  const bW  = 300;
  const bH  = balao.offsetHeight || 200;
  const marg = 12;

  const top    = Math.min.apply(null, colRects.map(function(r) { return r.y; }));
  const bottom = Math.max.apply(null, colRects.map(function(r) { return r.y + r.h; }));
  const midY   = (top + bottom) / 2;

  var bTop, bLeft;

  if (colRects.length === 2) {
    // Ordena pelo x para garantir esq/dir
    const sorted = colRects.slice().sort(function(a, b) { return a.x - b.x; });
    // Ponto médio exato entre a borda direita da col esquerda e a borda esquerda da col direita
    const midX = (sorted[0].x + sorted[0].w + sorted[1].x) / 2;
    bLeft = midX - bW / 2;
    bTop  = midY - bH / 2;
  } else {
    const right = Math.max.apply(null, colRects.map(function(r) { return r.x + r.w; }));
    const left  = Math.min.apply(null, colRects.map(function(r) { return r.x; }));
    if (vW - right >= bW + marg) {
      bLeft = right + marg;
      bTop  = midY - bH / 2;
    } else if (left >= bW + marg) {
      bLeft = left - marg - bW;
      bTop  = midY - bH / 2;
    } else if (vH - bottom >= bH + marg) {
      bTop  = bottom + marg;
      bLeft = left + (right - left) / 2 - bW / 2;
    } else {
      bTop  = top - marg - bH;
      bLeft = left + (right - left) / 2 - bW / 2;
    }
  }

  bLeft = Math.max(16, Math.min(bLeft, vW - bW - 16));
  bTop  = Math.max(16, Math.min(bTop,  vH - bH - 16));

  balao.style.left = bLeft + 'px';
  balao.style.top  = bTop  + 'px';
  _mostrarBalao();
}

let _tourDiarioAtual = 0;

function iniciarTourDiario() {
  _tourDiarioAtual = 0;
  document.body.classList.add('tour-ativo');
  document.getElementById('tour-overlay').style.display = 'block';
  _exibirPassoTourDiario(_tourDiarioAtual);
}

function _exibirPassoTourDiario(i) {
  _clearTourTimers();
  _tourRemoverSimulacao();

  const passo = _tourPassosDiario[i];
  if (i > 0 && _tourPassosDiario[i-1].onSair) _tourPassosDiario[i-1].onSair();

  const ids = passo.alvos || [passo.alvo];
  const els = ids.map(function(id) { return document.getElementById(id); }).filter(Boolean);
  if (!els.length) return;

  const svg  = document.getElementById('tour-overlay');
  const ns   = 'http://www.w3.org/2000/svg';
  const mask = svg.querySelector('#tour-mask');

  // ── Fase 1: fade-out suave do balão ──
  const balao = document.getElementById('tour-balao');
  _esconderBalao();

  // ── Fase 2 (após 160ms = duração do fade-out): troca conteúdo + highlight ──
  _tourTimeout(function() {

    svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

    // Atualiza conteúdo do balão enquanto está invisível
    document.getElementById('tour-titulo').textContent    = passo.titulo;
    document.getElementById('tour-desc').textContent      = passo.desc;
    document.getElementById('tour-progresso').textContent = (i + 1) + ' / ' + _tourPassosDiario.length;

    const btnAnt  = document.getElementById('tour-btn-ant');
    const btnProx = document.getElementById('tour-btn-prox');
    btnAnt.style.display = i === 0 ? 'none' : 'flex';
    btnProx.textContent  = i === _tourPassosDiario.length - 1 ? '✓ Concluir' : 'Próximo →';

    // Redireciona os botões para o tour do diário
    btnProx.onclick = tourProximoDiario;
    btnAnt.onclick  = tourAnteriorDiario;
    document.getElementById('tour-btn-pular').onclick = tourPularDiario;

    if (!passo._semHighlightInicial) {
      const rects = els.map(function(el) { return _getRectPadded(el, passo); });
      const x      = Math.min.apply(null, rects.map(function(r) { return r.x; }));
      const y      = Math.min.apply(null, rects.map(function(r) { return r.y; }));
      const right  = Math.max.apply(null, rects.map(function(r) { return r.right; }));
      const bottom = Math.max.apply(null, rects.map(function(r) { return r.bottom; }));
      const w = right - x, h = bottom - y;
      const cx = x + w / 2;

      const hole = document.createElementNS(ns, 'rect');
      hole.setAttribute('x', x); hole.setAttribute('y', y);
      hole.setAttribute('width', w); hole.setAttribute('height', h);
      hole.setAttribute('rx', 10); hole.setAttribute('fill', 'black');
      hole.classList.add('tour-dyn');
      mask.appendChild(hole);

      const border = document.createElementNS(ns, 'rect');
      border.setAttribute('x', x); border.setAttribute('y', y);
      border.setAttribute('width', w); border.setAttribute('height', h);
      border.setAttribute('rx', 10); border.setAttribute('fill', 'none');
      border.setAttribute('stroke', 'rgba(58,110,220,0.85)');
      border.setAttribute('stroke-width', '2.5');
      border.classList.add('tour-dyn');
      svg.appendChild(border);

      const vH = window.innerHeight / _getCssZoom();
      const bH = balao.offsetHeight || 200;
      const marg = 14;
      var bTop, bLeft;
      if (vH - bottom >= bH + marg) {
        bTop  = bottom + marg;
        bLeft = cx - 150;
      } else if (y >= bH + marg) {
        bTop  = y - marg - bH;
        bLeft = cx - 150;
      } else {
        bTop  = vH / 2 - bH / 2;
        bLeft = window.innerWidth / _getCssZoom() / 2 - 150;
      }
      bLeft = Math.max(16, Math.min(bLeft, window.innerWidth / _getCssZoom() - 316));
      bTop  = Math.max(16, Math.min(bTop, vH - bH - 16));
      balao.style.top  = bTop + 'px';
      balao.style.left = bLeft + 'px';
      _mostrarBalao();
    }

    // Para passos _semHighlightInicial: onEntrar cuida de desenhar highlight e chamar _mostrarBalao
    if (passo.onEntrar) passo.onEntrar.call(passo);

  }, 160);
}

function tourProximoDiario() {
  if (_tourDiarioAtual < _tourPassosDiario.length - 1) {
    _tourDiarioAtual++;
    _exibirPassoTourDiario(_tourDiarioAtual);
  } else {
    tourPularDiario();
  }
}

function tourAnteriorDiario() {
  if (_tourDiarioAtual > 0) {
    _tourDiarioAtual--;
    _exibirPassoTourDiario(_tourDiarioAtual);
  }
}

function tourPularDiario() {
  _clearTourTimers();
  _tourRemoverSimulacao();
  if (_tourPassosDiario[_tourDiarioAtual] && _tourPassosDiario[_tourDiarioAtual].onSair) {
    _tourPassosDiario[_tourDiarioAtual].onSair();
  }
  const svg = document.getElementById('tour-overlay');
  svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
  svg.style.display = 'none';
  _esconderBalao();
  document.body.classList.remove('tour-ativo');
  // Restaura os botões do tour do planejamento
  document.getElementById('tour-btn-prox').onclick  = tourProximo;
  document.getElementById('tour-btn-ant').onclick   = tourAnterior;
  document.getElementById('tour-btn-pular').onclick = tourPular;
}

let _tourAtual = 0;

function iniciarTour() {
  _tourAtual = 0;
  _tirarSnapshot();
  document.body.classList.add('tour-ativo');
  document.getElementById('tour-overlay').style.display = 'block';
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

  // ── Fase 1: fade-out suave do balão ──
  const balao = document.getElementById('tour-balao');
  _esconderBalao();

  // ── Fase 2 (após 160ms = duração do fade-out): troca conteúdo + highlight ──
  _tourTimeout(function() {

    svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());

    // Atualiza conteúdo do balão enquanto está invisível
    document.getElementById('tour-titulo').textContent = passo.titulo;
    document.getElementById('tour-desc').textContent = passo.desc;
    document.getElementById('tour-progresso').textContent = (i + 1) + ' / ' + _tourPassos.length;

    const btnAnt  = document.getElementById('tour-btn-ant');
    const btnProx = document.getElementById('tour-btn-prox');
    btnAnt.style.display = i === 0 ? 'none' : 'flex';
    btnProx.textContent  = i === _tourPassos.length - 1 ? '✓ Concluir' : 'Próximo →';

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
  document.querySelectorAll('.select-banco-list.open').forEach(l => l.classList.remove('open'));
  const svg = document.getElementById('tour-overlay');
  svg.querySelectorAll('.tour-dyn').forEach(e => e.remove());
  svg.style.display = 'none';
  _esconderBalao();
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