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

        // Fallback para cálculo local
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
            if (dispositivosSemVinculo > 0) {
                elSemVinculo.className = 'card-value warning';
            } else {
                elSemVinculo.className = 'card-value positive';
            }
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
                tbody.innerHTML = '';
                
                if (data.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Nenhum dispositivo encontrado.</td></tr>';
                    calcularKPIsLocais();
                    return;
                }

                data.data.forEach(disp => {
                    const tr = document.createElement('tr');
                    
                    let statusClass = 'status-operacional';
                    if (disp.status === 'Atenção' || disp.status === 'Atencao') statusClass = 'status-atencao';
                    if (disp.status === 'Crítico' || disp.status === 'Critico') statusClass = 'status-critico';
                    
                    const dataFormatada = disp.created_at ? new Date(disp.created_at).toLocaleString('pt-BR') : '--';

                    // Opções do Select de Empresas
                    let optionsHtml = `<option value="">-- Sem Empresa (Desvinculado) --</option>`;
                    listaEmpresas.forEach(emp => {
                        const isSelected = (disp.empresa_id && Number(disp.empresa_id) === Number(emp.id)) ? 'selected' : '';
                        optionsHtml += `<option value="${emp.id}" ${isSelected}>${emp.nome}</option>`;
                    });

                    tr.innerHTML = `
                        <td><strong>${disp.numero_serie}</strong></td>
                        <td>
                            <select class="select-empresa" id="select-empresa-${disp.numero_serie}">
                                ${optionsHtml}
                            </select>
                        </td>
                        <td><span class="status-badge ${statusClass}">${disp.status}</span></td>
                        <td>${dataFormatada}</td>
                        <td style="text-align: center;">
                            <button class="btn-salvar-vinculo" id="btn-save-${disp.numero_serie}" onclick="salvarVinculo('${disp.numero_serie}')">
                                Salvar
                            </button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                calcularKPIsLocais();
            } else {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Erro ao carregar os dados.</td></tr>';
            }
        } catch (error) {
            console.error('Erro ao carregar dispositivos:', error);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Falha de comunicação com o servidor.</td></tr>';
        }
    }

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
                showToast(data.message || `Dispositivo ${numeroSerie} atualizado com sucesso!`, 'success');
                const dispLocal = listaDispositivos.find(d => d.numero_serie === numeroSerie);
                if (dispLocal) dispLocal.empresa_id = empresaId;
                loadEstatisticas();
            } else {
                showToast(data.message || 'Erro ao vincular dispositivo à empresa.', 'error');
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
