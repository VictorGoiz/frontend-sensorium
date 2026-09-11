document.addEventListener('DOMContentLoaded', () => {
    
    // Proteção da rota
    const token = localStorage.getItem('sensorium_token');
    const userStr = localStorage.getItem('sensorium_user');
    
    if (!token || !userStr) {
        window.location.href = '../login/index.html';
        return;
    }

    const user = JSON.parse(userStr);
    if (user.perfil !== 'superadmin') {
        alert('Acesso negado. Apenas Super Admins podem acessar esta página.');
        window.location.href = '../home/index.html';
        return;
    }

    let listaEmpresas = [];
    let listaDispositivos = [];
    let searchQuery = '';

    const searchInput = document.getElementById('searchDispositivoInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            renderDevicesTable();
        });
    }

    init();

    async function init() {
        await loadEmpresas();
        await loadDispositivos();
        await loadEstatisticas();
    }

    async function loadEstatisticas() {
        try {
            const res = await fetch(`${API_BASE}/api/admin/estatisticas`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (data.success && data.data) {
                renderKPIs(data.data);
                return;
            }
        } catch (error) {
            console.warn('Fallback para cálculo local de estatísticas:', error);
        }

        calcularKPIsLocais();
    }

    function renderKPIs({ totalEmpresas, totalDispositivos, dispositivosSemVinculo, dispositivosOnline }) {
        const elEmpresas = document.getElementById('kpiEmpresas');
        const elTotal = document.getElementById('kpiTotalDispositivos');
        const elSemVinculo = document.getElementById('kpiSemVinculo');
        const elOnline = document.getElementById('kpiOnline');

        if (elEmpresas) elEmpresas.innerText = totalEmpresas ?? 0;
        if (elTotal) elTotal.innerText = totalDispositivos ?? 0;
        if (elSemVinculo) {
            elSemVinculo.innerText = dispositivosSemVinculo ?? 0;
            elSemVinculo.className = (dispositivosSemVinculo > 0) ? 'card-value warning' : 'card-value positive';
        }
        if (elOnline) elOnline.innerText = dispositivosOnline ?? 0;
    }

    function calcularKPIsLocais() {
        const totalEmpresas = listaEmpresas.length;
        const totalDispositivos = listaDispositivos.length;
        const dispositivosSemVinculo = listaDispositivos.filter(d => !d.empresa_id).length;
        const dispositivosOnline = listaDispositivos.filter(d => {
            const st = (d.status || '').toLowerCase();
            return st === 'operacional' || st === 'online';
        }).length;

        renderKPIs({
            totalEmpresas,
            totalDispositivos,
            dispositivosSemVinculo,
            dispositivosOnline
        });
    }

    async function loadEmpresas() {
        try {
            const res = await fetch(`${API_BASE}/api/admin/empresas`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                listaEmpresas = data.data;
            }
        } catch (error) {
            console.error('Erro ao carregar lista de empresas:', error);
        }
    }

    async function loadDispositivos() {
        const tbody = document.getElementById('devicesTableBody');
        try {
            const res = await fetch(`${API_BASE}/api/admin/dispositivos`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();

            if (data.success && data.data) {
                listaDispositivos = data.data;
                renderDevicesTable();
                renderClientsSummary();
                calcularKPIsLocais();
            } else {
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Erro ao carregar os dados.</td></tr>';
            }
        } catch (error) {
            console.error('Erro ao carregar dispositivos:', error);
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Falha de comunicação com o servidor.</td></tr>';
        }
    }

    /**
     * Renderiza a tabela de dispositivos respeitando busca textual
     */
    function renderDevicesTable() {
        const tbody = document.getElementById('devicesTableBody');
        const countSub = document.getElementById('devicesCountSub');
        if (!tbody) return;

        let filtrados = listaDispositivos.filter(disp => {
            if (searchQuery) {
                const serial = (disp.numero_serie || '').toLowerCase();
                const empNome = (disp.empresa_nome || '').toLowerCase();
                const status = (disp.status || '').toLowerCase();
                if (!serial.includes(searchQuery) && !empNome.includes(searchQuery) && !status.includes(searchQuery)) {
                    return false;
                }
            }
            return true;
        });

        if (countSub) {
            if (searchQuery) {
                countSub.innerText = `Exibindo ${filtrados.length} de ${listaDispositivos.length} dispositivos cadastrados`;
            } else {
                countSub.innerText = `Total de ${listaDispositivos.length} dispositivo(s) cadastrado(s)`;
            }
        }

        tbody.innerHTML = '';

        if (filtrados.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">Nenhum dispositivo encontrado para os filtros aplicados.</td></tr>';
            return;
        }

        filtrados.forEach(disp => {
            const tr = document.createElement('tr');
            
            let statusClass = 'status-operacional';
            const stLower = (disp.status || '').toLowerCase();
            if (stLower === 'atenção' || stLower === 'atencao') statusClass = 'status-atencao';
            if (stLower === 'crítico' || stLower === 'critico') statusClass = 'status-critico';
            
            const dataFormatada = disp.created_at ? new Date(disp.created_at).toLocaleString('pt-BR') : '--';

            // Opções do Select de Clientes
            let optionsHtml = `<option value="">-- Sem Cliente (Desvinculado) --</option>`;
            listaEmpresas.forEach(emp => {
                const isSelected = (disp.empresa_id && Number(disp.empresa_id) === Number(emp.id)) ? 'selected' : '';
                optionsHtml += `<option value="${emp.id}" ${isSelected}>${escapeHtml(emp.nome)}</option>`;
            });

            tr.innerHTML = `
                <td><strong>${escapeHtml(disp.numero_serie)}</strong></td>
                <td>
                    <select class="select-empresa" id="select-empresa-${disp.numero_serie}">
                        ${optionsHtml}
                    </select>
                </td>
                <td><span class="status-badge ${statusClass}">${disp.status || 'Operacional'}</span></td>
                <td>${dataFormatada}</td>
                <td style="text-align: center;">
                    <button class="btn-salvar-vinculo" id="btn-save-${disp.numero_serie}" onclick="salvarVinculo('${disp.numero_serie}')">
                        Salvar
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Renderiza a tabela lateral de clientes com a quantidade de dispositivos vinculados e botão de edição.
     * Apresenta estritamente os clientes cadastrados, no mesmo padrão da tabela principal, sem ícones.
     */
    function renderClientsSummary() {
        const tbody = document.getElementById('clientsTableBody');
        const countSub = document.getElementById('clientsCountSub');
        if (!tbody) return;

        if (countSub) {
            countSub.innerText = `${listaEmpresas.length} cliente(s) cadastrado(s)`;
        }

        if (listaEmpresas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 16px;">Nenhum cliente cadastrado.</td></tr>';
            return;
        }

        tbody.innerHTML = '';

        listaEmpresas.forEach(emp => {
            const count = listaDispositivos.filter(d => Number(d.empresa_id) === Number(emp.id)).length;
            const tr = document.createElement('tr');

            const badgeClass = count > 0 ? 'status-badge status-operacional' : 'status-badge status-padrao';

            tr.innerHTML = `
                <td>
                    <strong>${escapeHtml(emp.nome)}</strong>
                    ${emp.cnpj ? `<div class="sub-cnpj">${escapeHtml(emp.cnpj)}</div>` : ''}
                </td>
                <td style="text-align: center;">
                    <span class="${badgeClass}">${count} disp.</span>
                </td>
                <td style="text-align: center;">
                    <button type="button" class="btn-action-edit" onclick="abrirModalEditarCliente(${emp.id})">Editar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    /**
     * Abre o modal preenchendo os dados do cliente selecionado
     */
    window.abrirModalEditarCliente = function(clienteId) {
        const emp = listaEmpresas.find(e => Number(e.id) === Number(clienteId));
        if (!emp) return;

        const modal = document.getElementById('modalEditarCliente');
        const inputId = document.getElementById('editClienteId');
        const inputNome = document.getElementById('editClienteNome');
        const inputCnpj = document.getElementById('editClienteCnpj');

        if (inputId) inputId.value = emp.id;
        if (inputNome) inputNome.value = emp.nome || '';
        if (inputCnpj) inputCnpj.value = emp.cnpj || '';

        if (modal) modal.classList.add('active');
        if (inputNome) setTimeout(() => inputNome.focus(), 50);
    };

    /**
     * Fecha o modal de edição de cliente
     */
    window.fecharModalEditarCliente = function() {
        const modal = document.getElementById('modalEditarCliente');
        if (modal) modal.classList.remove('active');
    };

    /**
     * Salva as alterações feitas no cliente (nome e CNPJ)
     */
    window.salvarEdicaoCliente = async function(event) {
        if (event) event.preventDefault();

        const inputId = document.getElementById('editClienteId');
        const inputNome = document.getElementById('editClienteNome');
        const inputCnpj = document.getElementById('editClienteCnpj');
        const btnSalvar = document.getElementById('btnSalvarEdicaoCliente');

        if (!inputId || !inputNome) return;

        const clienteId = Number(inputId.value);
        const nome = inputNome.value.trim();
        const cnpj = inputCnpj ? inputCnpj.value.trim() : '';

        if (!nome) {
            showToast('O nome do cliente é obrigatório.', 'error');
            return;
        }

        if (btnSalvar) {
            btnSalvar.disabled = true;
            btnSalvar.innerText = 'Salvando...';
        }

        try {
            const res = await fetch(`${API_BASE}/api/admin/empresas/${clienteId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nome, cnpj })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                showToast(data.message || 'Cliente atualizado com sucesso!', 'success');

                // Atualiza dados na lista local de empresas
                const emp = listaEmpresas.find(e => Number(e.id) === clienteId);
                if (emp) {
                    emp.nome = nome;
                    emp.cnpj = cnpj;
                }

                // Atualiza nome da empresa nos dispositivos vinculados
                listaDispositivos.forEach(d => {
                    if (Number(d.empresa_id) === clienteId) {
                        d.empresa_nome = nome;
                    }
                });

                // Atualiza as tabelas na interface
                renderClientsSummary();
                renderDevicesTable();
                fecharModalEditarCliente();
            } else {
                showToast(data.message || 'Erro ao atualizar dados do cliente.', 'error');
            }
        } catch (error) {
            console.error('Erro ao atualizar cliente:', error);
            showToast('Erro de conexão ao salvar alterações do cliente.', 'error');
        } finally {
            if (btnSalvar) {
                btnSalvar.disabled = false;
                btnSalvar.innerText = 'Salvar Alterações';
            }
        }
    };

    /**
     * Salva o vínculo de um dispositivo com o cliente selecionado
     */
    window.salvarVinculo = async function(numeroSerie) {
        const select = document.getElementById(`select-empresa-${numeroSerie}`);
        const btn = document.getElementById(`btn-save-${numeroSerie}`);
        if (!select || !btn) return;

        const empresaId = select.value ? Number(select.value) : null;
        
        btn.disabled = true;
        btn.innerText = 'Salvando...';

        try {
            const res = await fetch(`${API_BASE}/api/admin/dispositivos/${encodeURIComponent(numeroSerie)}/empresa`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ empresa_id: empresaId })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                showToast(data.message || `Dispositivo ${numeroSerie} vinculado com sucesso!`, 'success');
                
                // Atualiza no cache local
                const dispLocal = listaDispositivos.find(d => d.numero_serie === numeroSerie);
                if (dispLocal) {
                    dispLocal.empresa_id = empresaId;
                    const emp = listaEmpresas.find(e => Number(e.id) === Number(empresaId));
                    dispLocal.empresa_nome = emp ? emp.nome : null;
                }

                // Atualiza interface: estatísticas, tabela de clientes e tabela de dispositivos
                calcularKPIsLocais();
                renderClientsSummary();
                renderDevicesTable();
            } else {
                showToast(data.message || 'Erro ao vincular dispositivo ao cliente.', 'error');
            }
        } catch (error) {
            console.error('Erro ao salvar vínculo do dispositivo:', error);
            showToast('Erro de conexão ao salvar vínculo.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = 'Salvar';
        }
    };

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.className = `toast-feedback ${type === 'success' ? 'toast-success' : 'toast-error'}`;
        toast.innerText = message;
        toast.style.display = 'block';

        setTimeout(() => {
            toast.style.display = 'none';
        }, 3500);
    }
});
