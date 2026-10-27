/**
 * ============================================================================
 * SENSIMONITOR - CONTROLADOR DO MODAL DE REGISTROS, CSV & EXCLUSÃO (UI)
 * ============================================================================
 * Centraliza os comportamentos comuns do Modal de Registros presente nas
 * páginas de dispositivos: abertura/fechamento, tecla ESC, clique no backdrop,
 * atalhos rápidos de data (Hoje, 7 dias, 30 dias), limpeza de filtros,
 * submodal de confirmação de exclusão e caixa de feedback visual.
 */
(function (global) {
    'use strict';

    /**
     * Exibe mensagem de feedback visual dentro do modal de registros
     */
    function exibirFeedbackModal(mensagem, tipo = 'info') {
        const box = document.getElementById('modalRegistrosFeedback');
        if (!box) return;

        box.className = `modal-feedback-box ${tipo}`;
        box.innerText = mensagem;
        box.style.display = 'block';

        if (tipo === 'success' || tipo === 'info') {
            setTimeout(() => {
                if (box.innerText === mensagem) {
                    box.style.display = 'none';
                }
            }, 5000);
        }
    }

    /**
     * Oculta e limpa a caixa de feedback do modal de registros
     */
    function limparFeedbackModal() {
        const box = document.getElementById('modalRegistrosFeedback');
        if (box) {
            box.style.display = 'none';
            box.innerText = '';
        }
    }

    /**
     * Fecha o submodal de confirmação de exclusão
     */
    function fecharConfirmacaoExclusao() {
        const confirmModal = document.getElementById('confirmDeleteModal');
        if (confirmModal) confirmModal.classList.remove('active');
    }

    /**
     * Fecha o modal principal de registros
     */
    function closeRegistrosModal() {
        const modal = document.getElementById('registrosModal');
        if (modal) {
            modal.classList.remove('active');
        }
        fecharConfirmacaoExclusao();
        document.removeEventListener('keydown', handleRegistrosEscKey);
    }

    /**
     * Fecha o modal ao clicar no backdrop escuro
     */
    function handleRegistrosModalBackdrop(event) {
        if (event && event.target && event.target.id === 'registrosModal') {
            closeRegistrosModal();
        }
    }

    /**
     * Fecha o submodal ou o modal principal ao pressionar ESC
     */
    function handleRegistrosEscKey(e) {
        if (e.key === 'Escape') {
            const confirmModal = document.getElementById('confirmDeleteModal');
            if (confirmModal && confirmModal.classList.contains('active')) {
                fecharConfirmacaoExclusao();
            } else {
                closeRegistrosModal();
            }
        }
    }

    /**
     * Aplica atalho rápido de datas ('hoje', '7dias', '30dias') e dispara a filtragem
     */
    function aplicarAtalhoData(tipo) {
        const inputInicio = document.getElementById('filterModalDataInicio');
        const inputFim = document.getElementById('filterModalDataFim');
        if (!inputInicio || !inputFim) return;

        document.querySelectorAll('.btn-preset-chip').forEach(btn => btn.classList.remove('active'));
        if (global.event && global.event.currentTarget && global.event.currentTarget.classList) {
            global.event.currentTarget.classList.add('active');
        }

        const agora = new Date();
        const fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59);
        let inicio;

        if (tipo === 'hoje') {
            inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0);
        } else if (tipo === '7dias') {
            inicio = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
            inicio.setHours(0, 0, 0, 0);
        } else if (tipo === '30dias') {
            inicio = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
            inicio.setHours(0, 0, 0, 0);
        }

        if (inicio && typeof global.formatDatetimeLocalInput === 'function') {
            inputInicio.value = global.formatDatetimeLocalInput(inicio);
            inputFim.value = global.formatDatetimeLocalInput(fim);
            if (typeof global.filtrarRegistrosModal === 'function') {
                global.filtrarRegistrosModal();
            }
        }
    }

    /**
     * Limpa os filtros de dispositivo e data do modal e recarrega a listagem
     */
    function limparFiltrosRegistrosModal() {
        const filterDevSelect = document.getElementById('filterModalDispositivo');
        const dataInicioInput = document.getElementById('filterModalDataInicio');
        const dataFimInput = document.getElementById('filterModalDataFim');

        if (filterDevSelect) filterDevSelect.value = 'todos';
        if (dataInicioInput) dataInicioInput.value = '';
        if (dataFimInput) dataFimInput.value = '';

        document.querySelectorAll('.btn-preset-chip').forEach(btn => btn.classList.remove('active'));

        limparFeedbackModal();
        if (typeof global.carregarRegistrosModal === 'function') {
            global.carregarRegistrosModal(1);
        } else if (typeof global.filtrarRegistrosModal === 'function') {
            global.filtrarRegistrosModal();
        }
    }

    /**
     * Baixa um CSV de rota autenticada (fetch + Blob). Substitui window.open, que
     * não envia o token. Usa o nome sugerido pelo servidor (Content-Disposition).
     * Retorna { ok, message }.
     */
    async function baixarCsvAutenticado(path, params, nomePadrao) {
        try {
            const headers = typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders() : {};
            const qs = new URLSearchParams(params || {}).toString();
            const res = await fetch(`${global.API_BASE}${path}${qs ? '?' + qs : ''}`, { headers });
            if (!res.ok) {
                const erro = await res.json().catch(() => ({}));
                return { ok: false, message: erro.message || `Falha ao exportar CSV (HTTP ${res.status}).` };
            }
            const blob = await res.blob();
            const disp = res.headers.get('Content-Disposition') || '';
            const m = disp.match(/filename="?([^";]+)"?/i);
            const nome = m ? m[1] : (nomePadrao || `registros_${new Date().toISOString().slice(0, 10)}.csv`);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nome;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return { ok: true, message: `Arquivo "${nome}" baixado.` };
        } catch (e) {
            return { ok: false, message: 'Erro de conexão ao exportar CSV.' };
        }
    }

    // Exporta no escopo global para compatibilidade com atributos onclick dos HTMLs
    global.baixarCsvAutenticado = baixarCsvAutenticado;
    global.exibirFeedbackModal = exibirFeedbackModal;
    global.mostrarFeedbackModal = exibirFeedbackModal;
    global.limparFeedbackModal = limparFeedbackModal;
    global.fecharConfirmacaoExclusao = fecharConfirmacaoExclusao;
    global.closeRegistrosModal = closeRegistrosModal;
    global.handleRegistrosModalBackdrop = handleRegistrosModalBackdrop;
    global.handleRegistrosEscKey = handleRegistrosEscKey;
    global.aplicarAtalhoData = aplicarAtalhoData;
    global.limparFiltrosRegistrosModal = limparFiltrosRegistrosModal;

    global.SensoriumRegistrosModal = {
        baixarCsvAutenticado,
        exibirFeedbackModal,
        limparFeedbackModal,
        fecharConfirmacaoExclusao,
        closeRegistrosModal,
        handleRegistrosModalBackdrop,
        handleRegistrosEscKey,
        aplicarAtalhoData,
        limparFiltrosRegistrosModal
    };
})(window);
