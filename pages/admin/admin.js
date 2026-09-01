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

    loadEmpresas();

    const formEmpresa = document.getElementById('formEmpresa');
    const formUsuario = document.getElementById('formUsuario');

    formEmpresa.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const nome = document.getElementById('nomeEmpresa').value;
        const cnpj = document.getElementById('cnpjEmpresa').value;

        try {
            const res = await fetch(`${API_BASE}/api/admin/empresas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nome, cnpj })
            });
            const data = await res.json();

            if (data.success) {
                alert('Empresa criada com sucesso!');
                formEmpresa.reset();
                loadEmpresas(); // Recarrega lista do select
            } else {
                alert(data.message || 'Erro ao criar empresa.');
            }
        } catch (error) {
            console.error('Erro:', error);
            alert('Erro de conexão ao criar empresa.');
        }
    });

    formUsuario.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const empresa_id = document.getElementById('selectEmpresa').value;
        const nome = document.getElementById('nomeUsuario').value;
        const email = document.getElementById('emailUsuario').value;
        const senha = document.getElementById('senhaUsuario').value;
        const perfil = document.getElementById('perfilUsuario').value;

        try {
            const res = await fetch(`${API_BASE}/api/admin/usuarios`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ empresa_id, nome, email, senha, perfil })
            });
            const data = await res.json();

            if (data.success) {
                alert('Usuário criado com sucesso!');
                formUsuario.reset();
            } else {
                alert(data.message || 'Erro ao criar usuário.');
            }
        } catch (error) {
            console.error('Erro:', error);
            alert('Erro de conexão ao criar usuário.');
        }
    });

    async function loadEmpresas() {
        try {
            const res = await fetch(`${API_BASE}/api/admin/empresas`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();

            const select = document.getElementById('selectEmpresa');
            select.innerHTML = '<option value="">Selecione uma empresa...</option>';

            if (data.success && data.data) {
                data.data.forEach(empresa => {
                    const option = document.createElement('option');
                    option.value = empresa.id;
                    option.textContent = empresa.nome;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Erro ao carregar empresas:', error);
            const select = document.getElementById('selectEmpresa');
            select.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    }
});
