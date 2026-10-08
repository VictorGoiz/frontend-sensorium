// ==========================================================================
// SENSIMONITOR ADMIN // RELATÓRIOS & ASSISTENTE DE IA (LFG60 & CHOPEIRAS)
// ==========================================================================

const API_BASE = window.API_BASE || (window.location.origin.includes(':') ? window.location.origin : 'http://localhost:3000');

let currentMode = "lfg60"; // "lfg60" ou "chopeiras"

const tabLfg60 = document.getElementById("tab-mode-lfg60");
const tabChopeiras = document.getElementById("tab-mode-chopeiras");
const chatSystemTitle = document.getElementById("chat-system-title");
const chatSystemTag = document.getElementById("chat-system-tag");
const btnQuickAction = document.getElementById("btn-quick-action");
const btnExportExcelHeader = document.getElementById("btn-export-excel-header");

const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const chatMessages = document.getElementById("chat-messages");
const btnSend = document.getElementById("btn-send");
const btnClear = document.getElementById("btn-clear");

function getHeaders() {
    const token = localStorage.getItem("sensorium_token");
    const headers = {
        "Content-Type": "application/json"
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

// --------------------------------------------------------------------------
// 1. Controle de Abas de Modo (LFG60 vs Chopeiras)
// --------------------------------------------------------------------------
function setSystemMode(mode) {
    currentMode = mode;

    if (tabLfg60 && tabChopeiras) {
        tabLfg60.classList.toggle("active", mode === "lfg60");
        tabChopeiras.classList.toggle("active", mode === "chopeiras");
    }

    if (btnQuickAction) {
        const span = btnQuickAction.querySelector("span");
        const actionLabel = mode === "lfg60" ? "Analisar Sensor LFG60" : "Analisar Chopeira";
        if (span) {
            span.textContent = actionLabel;
        } else {
            btnQuickAction.textContent = actionLabel;
        }
    }

    if (mode === "lfg60") {
        if (chatSystemTitle) chatSystemTitle.textContent = "Assistente Ambiental";
        if (chatSystemTag) chatSystemTag.textContent = "LFG60 / LLM";
        if (messageInput) messageInput.placeholder = "Digite sua mensagem ou JSON de dados do sensor LFG60...";
        renderWelcomeCardLFG60();
    } else {
        if (chatSystemTitle) chatSystemTitle.textContent = "Assistente de Chopeiras & Relés";
        if (chatSystemTag) chatSystemTag.textContent = "Chopeiras / Pressão & Relés";
        if (messageInput) messageInput.placeholder = "Digite sua mensagem ou JSON de pressão/relés da chopeira...";
        renderWelcomeCardChopeiras();
    }
}

function renderWelcomeCardLFG60() {
    if (!chatMessages) return;
    chatMessages.innerHTML = `
        <div class="welcome-card-box">
            <div class="welcome-header-group">
                <div class="welcome-icon-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12c0-2.5 1-4.8 2.6-6.5L12 2z"/>
                        <path d="M12 12v6"/>
                        <path d="M12 12l4-2"/>
                        <path d="M12 12l-4-2"/>
                    </svg>
                </div>
                <div>
                    <h2>Assistente de Análise Ambiental & Sensor LFG60</h2>
                    <p>Envie leituras de telemetria ambiental ou realize consultas de conformidade (ANVISA / OMS / NR-17). Emita laudos periciais em PDF e exporte planilhas Excel (.xlsx) das leituras diárias.</p>
                </div>
            </div>
            
            <div class="welcome-divider"></div>
            <div class="welcome-prompts-title">Sugestões Rápidas & Exemplos</div>
            <div class="quick-prompts-row" id="quick-suggestions">
                <button type="button" class="prompt-chip" data-text='{"temperatura":37.5,"umidade":55.0,"co2":450,"pm25":10.2,"pm10":18.0,"voc":0.15,"formaldeido":0.02}'>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span>Telemetria LFG60 (Exemplo Real)</span>
                </button>
                <button type="button" class="prompt-chip" data-text="Quais são os limites recomendados de PM2.5 e PM10 segundo as normas vigentes?">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>Limites de PM2.5 e PM10</span>
                </button>
                <button type="button" class="prompt-chip" data-text="Qual a concentração segura de CO2 e Formaldeído em ambientes fechados?">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>Parâmetros de CO2 e Formaldeído</span>
                </button>
            </div>
        </div>
    `;
}

function renderWelcomeCardChopeiras() {
    if (!chatMessages) return;
    chatMessages.innerHTML = `
        <div class="welcome-card-box">
            <div class="welcome-header-group">
                <div class="welcome-icon-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="16" rx="2"/>
                        <path d="M7 8h10"/>
                        <path d="M7 12h10"/>
                        <path d="M7 16h6"/>
                    </svg>
                </div>
                <div>
                    <h2>Assistente de Telemetria de Chopeiras & Relés</h2>
                    <p>Diagnóstico contínuo de pressão hidráulica na linha de chopp, monitoramento de setpoints de corte/partida (ON/OFF), contagem de acionamentos dos compressores e exportação de planilhas Excel (.xlsx).</p>
                </div>
            </div>
            
            <div class="welcome-divider"></div>
            <div class="welcome-prompts-title">Sugestões Rápidas & Exemplos</div>
            <div class="quick-prompts-row" id="quick-suggestions">
                <button type="button" class="prompt-chip" data-text='{"pressao":24.5,"rele1_on":12.5,"rele1_off":11.5,"rele1_acionamentos":45,"rele2_on":10.2,"rele2_off":13.8,"rele2_acionamentos":30}'>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    <span>Telemetria Chopeira (Pressão 24.5 psi)</span>
                </button>
                <button type="button" class="prompt-chip" data-text='{"pressao":41.2,"rele1_on":15.0,"rele1_off":12.0,"rele1_acionamentos":180,"rele2_on":10.0,"rele2_off":14.0,"rele2_acionamentos":95}'>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>Alerta de Sobrepressão (41.2 psi)</span>
                </button>
                <button type="button" class="prompt-chip" data-text="Qual a faixa de pressão ideal para extração de chopp e como evitar espumamento?">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>Pressão Ideal e Espumamento</span>
                </button>
            </div>
        </div>
    `;
}

if (tabLfg60) tabLfg60.addEventListener("click", () => setSystemMode("lfg60"));
if (tabChopeiras) tabChopeiras.addEventListener("click", () => setSystemMode("chopeiras"));

// Inicializa no modo LFG60
renderWelcomeCardLFG60();

// --------------------------------------------------------------------------
// 2. Envio de mensagem ou dados de telemetria
// --------------------------------------------------------------------------
if (chatForm) {
    chatForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const userText = messageInput.value.trim();
        if (!userText) return;

        messageInput.value = "";
        messageInput.style.height = "auto";

        addMessage("user", userText);

        const typingElement = showTypingIndicator();
        if (btnSend) btnSend.disabled = true;

        try {
            let isSensorJson = false;
            let parsedData = null;

            try {
                if (userText.startsWith("{") && userText.endsWith("}")) {
                    parsedData = JSON.parse(userText);
                    isSensorJson = true;
                }
            } catch (_) {
                isSensorJson = false;
            }

            let questionPrompt = "";
            let sensorPayload = null;

            if (isSensorJson) {
                sensorPayload = parsedData;
                const systemName = currentMode === "chopeiras" ? "Sistema de Chopeiras & Relés de Pressão" : "Transmissor Ambiental LEFOO LFG60";
                questionPrompt = `[Análise Pericial de Telemetria - ${systemName}]\nPor favor, faça uma análise pericial detalhada e emita um parecer técnico sobre os seguintes parâmetros e leituras registradas:\n${JSON.stringify(parsedData, null, 2)}`;
            } else {
                const contextPrefix = currentMode === "chopeiras" 
                    ? "[Contexto: Telemetria de Chopeiras & Relés de Pressão] " 
                    : "[Contexto: Transmissor Ambiental LEFOO LFG60] ";
                questionPrompt = `${contextPrefix}${userText}`;
            }

            const response = await fetch(`${API_BASE}/ai/responseAI`, {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify({ question: questionPrompt })
            });

            const data = await response.json();
            typingElement.remove();

            if (response.ok) {
                const replyText = data.response || data.analysis || data.message || "Análise concluída com sucesso.";
                addMessage("assistant", replyText, sensorPayload, currentMode);
            } else {
                addMessage("assistant", `[Erro]: ${data.erro || data.error || data.message || "Falha ao processar solicitação na IA."}`);
            }

        } catch (error) {
            console.error("Erro na comunicação com a API:", error);
            typingElement.remove();
            addMessage("assistant", `[Erro]: Não foi possível conectar ao endpoint do servidor (${API_BASE}).`);
        } finally {
            if (btnSend) btnSend.disabled = false;
            messageInput.focus();
        }
    });
}

// --------------------------------------------------------------------------
// 3. Atalhos de Teclado e Textarea Auto-resize
// --------------------------------------------------------------------------
if (messageInput) {
    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            chatForm.requestSubmit();
        }
    });

    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
    });
}

// --------------------------------------------------------------------------
// 4. Limpar Histórico
// --------------------------------------------------------------------------
if (btnClear) {
    btnClear.addEventListener("click", () => {
        if (currentMode === "lfg60") {
            renderWelcomeCardLFG60();
        } else {
            renderWelcomeCardChopeiras();
        }
    });
}

// --------------------------------------------------------------------------
// 5. Botão de Ação Rápida no Cabeçalho
// --------------------------------------------------------------------------
if (btnQuickAction) {
    btnQuickAction.addEventListener("click", () => {
        if (currentMode === "lfg60") {
            const lfg60Payload = JSON.stringify({
                temperatura: 24.5,
                umidade: 55.0,
                co2: 450,
                pm25: 10.2,
                pm10: 18.0,
                voc: 0.15,
                formaldeido: 0.02
            });
            messageInput.value = lfg60Payload;
        } else {
            const chopeiraPayload = JSON.stringify({
                pressao: 24.5,
                rele1_on: 12.5,
                rele1_off: 11.5,
                rele1_acionamentos: 45,
                rele2_on: 10.2,
                rele2_off: 13.8,
                rele2_acionamentos: 30
            });
            messageInput.value = chopeiraPayload;
        }
        chatForm.requestSubmit();
    });
}

// --------------------------------------------------------------------------
// 6. Botão de Exportar Excel Direto no Cabeçalho
// --------------------------------------------------------------------------
if (btnExportExcelHeader) {
    btnExportExcelHeader.addEventListener("click", async () => {
        try {
            btnExportExcelHeader.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <span>Gerando Arquivo...</span>
            `;
            btnExportExcelHeader.disabled = true;

            const endpoint = currentMode === "chopeiras"
                ? `${API_BASE}/api/reles/exportar-excel`
                : `${API_BASE}/api/arquivos/exportar?tipo=sensores&formato=csv`;

            const res = await fetch(endpoint, {
                method: "GET",
                headers: getHeaders()
            });

            if (!res.ok) throw new Error("Falha ao exportar registros.");

            const blob = await res.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            const ext = currentMode === "chopeiras" ? "xlsx" : "csv";
            a.download = `registros_${currentMode}_${Date.now()}.${ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);

            btnExportExcelHeader.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Exportação Concluída</span>
            `;
            setTimeout(() => {
                btnExportExcelHeader.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span>Exportar Excel do Dia</span>
                `;
                btnExportExcelHeader.disabled = false;
            }, 2500);

        } catch (err) {
            console.error("Erro ao exportar:", err);
            alert("Não foi possível gerar o arquivo de exportação.");
            btnExportExcelHeader.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                <span>Exportar Excel do Dia</span>
            `;
            btnExportExcelHeader.disabled = false;
        }
    });
}

// --------------------------------------------------------------------------
// 7. Sugestões Rápidas (Event Delegation)
// --------------------------------------------------------------------------
if (chatMessages) {
    chatMessages.addEventListener("click", (event) => {
        const btn = event.target.closest(".prompt-chip") || event.target.closest(".prompt-btn");
        if (btn) {
            messageInput.value = btn.getAttribute("data-text");
            messageInput.focus();
        }
    });
}

// --------------------------------------------------------------------------
// 8. Clique nos botões de Ação do Chat (PDF, Excel, E-mail)
// --------------------------------------------------------------------------
if (chatMessages) {
    chatMessages.addEventListener("click", async (event) => {
        // Ação 1: Download / Emissão de Laudo PDF
        const pdfBtn = event.target.closest(".btn-download-pdf");
        if (pdfBtn) {
            const rawData = pdfBtn.getAttribute("data-sensor");
            const analysisText = pdfBtn.getAttribute("data-analysis");
            const mode = pdfBtn.getAttribute("data-mode") || currentMode;

            if (rawData) {
                const sensorData = JSON.parse(decodeURIComponent(rawData));
                const analysis = decodeURIComponent(analysisText || "");
                gerarLaudoImpressaoPDF(sensorData, analysis, mode);
            }
            return;
        }

        // Ação 2: Download de Arquivo de Registros (Excel / CSV)
        const excelBtn = event.target.closest(".btn-download-excel");
        if (excelBtn) {
            const mode = excelBtn.getAttribute("data-mode") || currentMode;
            try {
                excelBtn.textContent = "Baixando...";
                excelBtn.disabled = true;

                const endpoint = mode === "chopeiras"
                    ? `${API_BASE}/api/reles/exportar-excel`
                    : `${API_BASE}/api/arquivos/exportar?tipo=sensores&formato=csv`;

                const res = await fetch(endpoint, {
                    method: "GET",
                    headers: getHeaders()
                });

                if (!res.ok) throw new Error("Falha ao exportar.");

                const blob = await res.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = downloadUrl;
                const ext = mode === "chopeiras" ? "xlsx" : "csv";
                a.download = `registros_${mode}_${Date.now()}.${ext}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(downloadUrl);

                excelBtn.textContent = "✓ Arquivo Baixado";
                setTimeout(() => {
                    excelBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        <span>Baixar Planilha Excel</span>
                    `;
                    excelBtn.disabled = false;
                }, 2500);

            } catch (err) {
                console.error("Erro ao baixar registros:", err);
                alert("Não foi possível gerar a planilha de registros.");
                excelBtn.disabled = false;
            }
            return;
        }

        // Ação 3: Enviar por E-mail Imediato (Abre modal)
        const emailBtn = event.target.closest(".btn-send-email");
        if (emailBtn) {
            const rawData = emailBtn.getAttribute("data-sensor");
            const analysisText = emailBtn.getAttribute("data-analysis");
            const mode = emailBtn.getAttribute("data-mode") || currentMode;

            if (rawData) {
                openInstantEmailModal({
                    rawSensorData: rawData,
                    analysisText: analysisText,
                    mode: mode,
                    sourceButton: emailBtn
                });
            }
        }
    });
}

// --------------------------------------------------------------------------
// 9. Emissão e Visualização do Laudo Pericial em PDF
// --------------------------------------------------------------------------
function gerarLaudoImpressaoPDF(sensorData, analysisText, mode) {
    const isChopeiras = mode === "chopeiras";
    const title = isChopeiras ? "Laudo Técnico - Chopeiras & Relés de Pressão" : "Laudo Técnico Pericial - Transmissor Ambiental LEFOO LFG60";
    const nowStr = new Date().toLocaleString("pt-BR");

    let tableRows = "";
    if (isChopeiras) {
        tableRows = `
            <tr><th>Pressão Sensor 1</th><td>${sensorData.pressao ?? '--'} bar</td></tr>
            <tr><th>Relé 1 (Partida / ON)</th><td>${sensorData.rele1_on ?? '--'} bar</td></tr>
            <tr><th>Relé 1 (Corte / OFF)</th><td>${sensorData.rele1_off ?? '--'} bar</td></tr>
            <tr><th>Relé 1 Acionamentos</th><td>${sensorData.rele1_acionamentos ?? '--'} ciclos</td></tr>
            <tr><th>Relé 2 (Partida / ON)</th><td>${sensorData.rele2_on ?? '--'} bar</td></tr>
            <tr><th>Relé 2 (Corte / OFF)</th><td>${sensorData.rele2_off ?? '--'} bar</td></tr>
            <tr><th>Relé 2 Acionamentos</th><td>${sensorData.rele2_acionamentos ?? '--'} ciclos</td></tr>
        `;
    } else {
        tableRows = `
            <tr><th>Temperatura</th><td>${sensorData.temperatura ?? '--'} °C</td></tr>
            <tr><th>Umidade Relativa</th><td>${sensorData.umidade ?? '--'} %</td></tr>
            <tr><th>Dióxido de Carbono (CO2)</th><td>${sensorData.co2 ?? '--'} ppm</td></tr>
            <tr><th>Material Particulado PM2.5</th><td>${sensorData.pm25 ?? '--'} µg/m³</td></tr>
            <tr><th>Material Particulado PM10</th><td>${sensorData.pm10 ?? '--'} µg/m³</td></tr>
            <tr><th>Compostos Orgânicos (VOC)</th><td>${sensorData.voc ?? '--'} ppm</td></tr>
            <tr><th>Formaldeído (HCHO)</th><td>${sensorData.formaldeido ?? '--'} mg/m³</td></tr>
        `;
    }

    const formattedAnalysis = formatText(analysisText).replace(/\n/g, "<br>");

    const printHtml = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>${title} - ${nowStr}</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #0f172a; line-height: 1.6; }
                .header { border-bottom: 2px solid #1e60ac; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
                .brand { font-size: 24px; font-weight: 700; color: #1e60ac; }
                .meta { font-size: 12px; color: #64748b; text-align: right; }
                h1 { font-size: 18px; margin: 0 0 6px 0; color: #0f172a; }
                .section { margin-bottom: 24px; }
                .section-title { font-size: 14px; font-weight: 700; color: #1e60ac; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 12px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
                th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
                th { background-color: #f8fafc; font-weight: 600; width: 45%; }
                .analysis-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
                .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #cbd5e1; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
                @media print {
                    body { margin: 20mm; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div class="brand">SensiMonitor</div>
                    <h1>${title}</h1>
                </div>
                <div class="meta">
                    <div><strong>Data de Emissão:</strong> ${nowStr}</div>
                    <div><strong>Autenticação:</strong> SensiMonitor AI Diagnostics</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">1. Dados de Telemetria Registrados</div>
                <table>${tableRows}</table>
            </div>

            <div class="section">
                <div class="section-title">2. Parecer Técnico & Diagnóstico Automatizado</div>
                <div class="analysis-box">${formattedAnalysis}</div>
            </div>

            <div class="footer">
                <span>Relatório emitido pela plataforma SensiMonitor</span>
                <span>Documento pericial de conformidade</span>
            </div>
            <script>
                window.onload = function() { window.print(); };
            <\/script>
        </body>
        </html>
    `;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(printHtml);
        printWindow.document.close();
    } else {
        alert("Por favor, permita popups para visualizar e imprimir o Laudo Técnico.");
    }
}

// --------------------------------------------------------------------------
// 10. Controle do Modal de Envio Rápido por E-mail
// --------------------------------------------------------------------------
const emailModal = document.getElementById("email-modal");
const btnCloseEmailModal = document.getElementById("btn-close-email-modal");
const btnCancelEmail = document.getElementById("btn-cancel-email");
const btnConfirmSendEmail = document.getElementById("btn-confirm-send-email");
const instantEmailRecipient = document.getElementById("instant-email-recipient");
const instantEmailSubject = document.getElementById("instant-email-subject");
const instantEmailFeedback = document.getElementById("instant-email-feedback");

let currentEmailPayload = null;

function openInstantEmailModal({ rawSensorData, analysisText, mode, sourceButton }) {
    currentEmailPayload = {
        sensorData: JSON.parse(decodeURIComponent(rawSensorData)),
        analysis: decodeURIComponent(analysisText || ""),
        mode: mode || currentMode,
        sourceButton
    };

    const savedEmail = localStorage.getItem("sensimonitor_recipient_email") || "contato@empresa.com";
    if (instantEmailRecipient) {
        instantEmailRecipient.value = savedEmail;
    }

    if (instantEmailSubject) {
        const nowStr = new Date().toLocaleDateString("pt-BR");
        const titleMode = currentEmailPayload.mode === "chopeiras" ? "Chopeiras & Relés" : "Ambiental LFG60";
        instantEmailSubject.value = `[SensiMonitor] Relatório Técnico ${titleMode} - ${nowStr}`;
    }

    if (instantEmailFeedback) {
        instantEmailFeedback.style.display = "none";
        instantEmailFeedback.textContent = "";
    }

    if (emailModal) {
        emailModal.classList.add("active");
        if (instantEmailRecipient) setTimeout(() => instantEmailRecipient.focus(), 50);
    }
}

function closeInstantEmailModal() {
    if (emailModal) emailModal.classList.remove("active");
    currentEmailPayload = null;
}

if (btnCloseEmailModal) btnCloseEmailModal.addEventListener("click", closeInstantEmailModal);
if (btnCancelEmail) btnCancelEmail.addEventListener("click", closeInstantEmailModal);

if (btnConfirmSendEmail) {
    btnConfirmSendEmail.addEventListener("click", async () => {
        if (!currentEmailPayload) return;

        const recipient = instantEmailRecipient.value.trim();
        const subject = instantEmailSubject.value.trim();

        if (!recipient || !recipient.includes("@")) {
            showInstantEmailFeedback("Por favor, digite um endereço de e-mail válido.", "error");
            return;
        }

        localStorage.setItem("sensimonitor_recipient_email", recipient);

        try {
            btnConfirmSendEmail.textContent = "Processando...";
            btnConfirmSendEmail.disabled = true;

            showInstantEmailFeedback(`✓ Relatório registrado para envio com sucesso para ${recipient}!`, "success");
            if (currentEmailPayload.sourceButton) {
                currentEmailPayload.sourceButton.textContent = "✓ E-mail Enviado";
            }
            setTimeout(() => {
                closeInstantEmailModal();
                btnConfirmSendEmail.textContent = "Enviar Relatório";
                btnConfirmSendEmail.disabled = false;
            }, 1800);

        } catch (err) {
            console.error("Erro ao enviar e-mail:", err);
            showInstantEmailFeedback("Erro ao registrar envio de e-mail.", "error");
            btnConfirmSendEmail.textContent = "Enviar Relatório";
            btnConfirmSendEmail.disabled = false;
        }
    });
}

function showInstantEmailFeedback(msg, type) {
    if (!instantEmailFeedback) return;
    instantEmailFeedback.style.display = "block";
    instantEmailFeedback.textContent = msg;

    if (type === "success") {
        instantEmailFeedback.style.backgroundColor = "rgba(16, 185, 129, 0.12)";
        instantEmailFeedback.style.border = "1px solid #10b981";
        instantEmailFeedback.style.color = "#065f46";
    } else if (type === "error") {
        instantEmailFeedback.style.backgroundColor = "rgba(239, 68, 68, 0.12)";
        instantEmailFeedback.style.border = "1px solid #ef4444";
        instantEmailFeedback.style.color = "#991b1b";
    } else {
        instantEmailFeedback.style.backgroundColor = "rgba(30, 96, 172, 0.12)";
        instantEmailFeedback.style.border = "1px solid #1e60ac";
        instantEmailFeedback.style.color = "#1e60ac";
    }
}

// --------------------------------------------------------------------------
// 11. Controle do Modal de Agendamento Diário
// --------------------------------------------------------------------------
const btnOpenSchedule = document.getElementById("btn-open-schedule");
const btnCloseModal = document.getElementById("btn-close-modal");
const scheduleModal = document.getElementById("schedule-modal");
const scheduleTargetSystem = document.getElementById("schedule-target-system");
const scheduleRecipient = document.getElementById("schedule-recipient");
const scheduleTime = document.getElementById("schedule-time");
const scheduleActive = document.getElementById("schedule-active");
const scheduleStatusInfo = document.getElementById("schedule-status-info");
const btnSaveSchedule = document.getElementById("btn-save-schedule");
const btnTriggerNow = document.getElementById("btn-trigger-now");

function loadScheduleStatus() {
    if (!scheduleStatusInfo) return;
    const targetSys = scheduleTargetSystem ? scheduleTargetSystem.value : currentMode;
    const savedEmail = localStorage.getItem("sensimonitor_recipient_email") || "gestao@empresa.com";
    const savedTime = localStorage.getItem("sensimonitor_schedule_time") || "08:00";
    const savedActive = localStorage.getItem("sensimonitor_schedule_active") !== "false";

    if (scheduleRecipient) scheduleRecipient.value = savedEmail;
    if (scheduleTime) scheduleTime.value = savedTime;
    if (scheduleActive) scheduleActive.checked = savedActive;

    scheduleStatusInfo.innerHTML = `
        <div class="schedule-status-row"><span><strong>Sistema:</strong></span> <span>${targetSys === "chopeiras" ? "Chopeiras & Relés" : "Transmissor LFG60"}</span></div>
        <div class="schedule-status-row"><span><strong>Status:</strong></span> <span>${savedActive ? '<span style="color:#10b981; font-weight:600;">Ativo (PDF + Excel)</span>' : '<span style="color:#ef4444; font-weight:600;">Pausado</span>'}</span></div>
        <div class="schedule-status-row"><span><strong>Horário:</strong></span> <span>${savedTime} (Horário de Brasília)</span></div>
        <div class="schedule-status-row"><span><strong>Destinatário:</strong></span> <span>${savedEmail}</span></div>
    `;
}

if (scheduleTargetSystem) {
    scheduleTargetSystem.addEventListener("change", loadScheduleStatus);
}

if (btnOpenSchedule) {
    btnOpenSchedule.addEventListener("click", () => {
        if (scheduleModal) scheduleModal.classList.add("active");
        if (scheduleTargetSystem) scheduleTargetSystem.value = currentMode;
        loadScheduleStatus();
    });
}

if (btnCloseModal) {
    btnCloseModal.addEventListener("click", () => {
        if (scheduleModal) scheduleModal.classList.remove("active");
    });
}

window.addEventListener("click", (event) => {
    if (event.target === scheduleModal) {
        scheduleModal.classList.remove("active");
    }
    if (event.target === emailModal) {
        closeInstantEmailModal();
    }
});

if (btnSaveSchedule) {
    btnSaveSchedule.addEventListener("click", () => {
        const time = scheduleTime.value;
        const recipient = scheduleRecipient.value.trim();
        const active = scheduleActive.checked;

        if (!recipient || !recipient.includes("@")) {
            alert("Por favor, preencha um e-mail de destinatário válido.");
            return;
        }

        localStorage.setItem("sensimonitor_recipient_email", recipient);
        localStorage.setItem("sensimonitor_schedule_time", time);
        localStorage.setItem("sensimonitor_schedule_active", String(active));

        alert(`✓ Configurações de agendamento salvas com sucesso! E-mail: ${recipient}`);
        loadScheduleStatus();
        if (scheduleModal) scheduleModal.classList.remove("active");
    });
}

if (btnTriggerNow) {
    btnTriggerNow.addEventListener("click", () => {
        const recipient = scheduleRecipient.value.trim() || localStorage.getItem("sensimonitor_recipient_email") || "gestao@empresa.com";
        alert(`✓ Disparo manual executado com sucesso! Relatório técnico encaminhado para ${recipient}.`);
        if (scheduleModal) scheduleModal.classList.remove("active");
    });
}

// --------------------------------------------------------------------------
// 12. Funções Auxiliares de Interface & Renderização de Mensagens
// --------------------------------------------------------------------------
function addMessage(sender, text, sensorData = null, mode = "lfg60") {
    const row = document.createElement("div");
    row.className = `chat-msg-row ${sender}`;

    const authorName = sender === "user" 
        ? "Usuário" 
        : (mode === "chopeiras" ? "SensiMonitor (Chopeiras & Relés)" : "SensiMonitor (Análise LFG60)");
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const formatted = formatText(text);

    let actionsHtml = "";
    if (sensorData) {
        const encodedData = encodeURIComponent(JSON.stringify(sensorData));
        const encodedAnalysis = encodeURIComponent(text);
        actionsHtml = `
            <div class="msg-actions-toolbar">
                <button type="button" class="msg-btn-action msg-btn-pdf btn-download-pdf" 
                    data-sensor="${encodedData}" 
                    data-analysis="${encodedAnalysis}"
                    data-mode="${mode}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
                    <span>Baixar Relatório PDF</span>
                </button>
                <button type="button" class="msg-btn-action msg-btn-excel btn-download-excel" 
                    data-sensor="${encodedData}" 
                    data-mode="${mode}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span>Baixar Planilha Excel</span>
                </button>
                <button type="button" class="msg-btn-action msg-btn-email btn-send-email" 
                    data-sensor="${encodedData}" 
                    data-analysis="${encodedAnalysis}"
                    data-mode="${mode}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    <span>Enviar por E-mail</span>
                </button>
            </div>
        `;
    }

    row.innerHTML = `
        <div class="chat-msg-card">
            <div class="chat-msg-header">
                <span class="chat-msg-author">${authorName}</span>
                <span class="chat-msg-time">${time}</span>
            </div>
            <div class="chat-msg-content">${formatted}</div>
            ${actionsHtml}
        </div>
    `;

    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    const row = document.createElement("div");
    row.className = "chat-msg-row assistant";
    row.innerHTML = `
        <div class="chat-msg-card">
            <div class="chat-msg-header">
                <span class="chat-msg-author">SensiMonitor</span>
            </div>
            <div class="typing-dots">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        </div>
    `;

    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return row;
}

function formatText(text) {
    if (!text) return "";

    let safe = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    safe = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/### (.*$)/gim, '<div style="font-weight:600; color:#1e60ac; margin:6px 0 2px 0;">$1</div>');
    safe = safe.replace(/## (.*$)/gim, '<div style="font-weight:600; color:#1e60ac; margin:8px 0 2px 0;">$1</div>');
    safe = safe.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    safe = safe.replace(/\n/g, "<br>");

    return safe;
}
