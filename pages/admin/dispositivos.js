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

    loadDispositivos();

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
                tbody.innerHTML = '';
                
                if (data.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Nenhum dispositivo encontrado.</td></tr>';
                    return;
                }

                data.data.forEach(disp => {
                    const tr = document.createElement('tr');
                    
                    let statusClass = 'status-operacional';
                    if (disp.status === 'Atenção' || disp.status === 'Atencao') statusClass = 'status-atencao';
                    if (disp.status === 'Crítico' || disp.status === 'Critico') statusClass = 'status-critico';
                    
                    const dataFormatada = new Date(disp.created_at).toLocaleString('pt-BR');

                    tr.innerHTML = `
                        <td><strong>${disp.numero_serie}</strong></td>
                        <td>${disp.empresa_nome || '<span style="color:#999">Sem empresa vinculada</span>'}</td>
                        <td><span class="status-badge ${statusClass}">${disp.status}</span></td>
                        <td>${dataFormatada}</td>
                    `;
                    tbody.appendChild(tr);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">Erro ao carregar os dados.</td></tr>';
            }
        } catch (error) {
            console.error('Erro ao carregar dispositivos:', error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">Falha de comunicação com o servidor.</td></tr>';
        }
    }
});
