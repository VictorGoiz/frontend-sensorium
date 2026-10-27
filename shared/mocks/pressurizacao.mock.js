/**
 * ============================================================================
 * SENSIMONITOR - DADOS SIMULADOS E SIMULADOR DE PRESSURIZAÇÃO (MOCK)
 * ============================================================================
 * Fornece estações de pressurização de água para demonstração e simulação
 * contínua do ciclo hidropneumático quando a API não possui dados reais.
 */
(function (global) {
    'use strict';

    const SIMULATED_PRESSURIZACAO_DEVICES = [
        {
            numero_serie: 'PRESS-01',
            nome: 'Barrilete Principal - Torre A',
            cliente: 'Edifício Corporativo Horizon',
            status: 'Operacional',
            isSimulated: true,
            ultima_leitura: {
                sensor1: 44.5,
                rele1_on: 35.0,
                rele1_off: 50.0,
                rele1_acionamentos: 142,
                rele1_estado: 0,
                rele2_on: 32.0,
                rele2_off: 50.0,
                rele2_acionamentos: 38,
                rele2_estado: 0,
                timestamp: new Date().toISOString()
            }
        },
        {
            numero_serie: 'PRESS-02',
            nome: 'Estação Elevatória - Bloco B',
            cliente: 'Residencial Reserva das Águas',
            status: 'Operacional',
            isSimulated: true,
            ultima_leitura: {
                sensor1: 38.2,
                rele1_on: 30.0,
                rele1_off: 48.0,
                rele1_acionamentos: 96,
                rele1_estado: 0,
                rele2_on: 28.0,
                rele2_off: 48.0,
                rele2_acionamentos: 19,
                rele2_estado: 0,
                timestamp: new Date().toISOString()
            }
        },
        {
            numero_serie: 'PRESS-03',
            nome: 'Booster Hidropneumático - Subsolo',
            cliente: 'Centro Logístico Integrado',
            status: 'Operacional',
            isSimulated: true,
            ultima_leitura: {
                sensor1: 48.0,
                rele1_on: 40.0,
                rele1_off: 60.0,
                rele1_acionamentos: 215,
                rele1_estado: 0,
                rele2_on: 36.0,
                rele2_off: 60.0,
                rele2_acionamentos: 52,
                rele2_estado: 0,
                timestamp: new Date().toISOString()
            }
        }
    ];

    /**
     * Executa um passo de simulação in-place nas estações de pressurização simuladas
     * @param {Array} devices Lista de estações atual
     * @returns {boolean} true se ao menos uma estação simulada foi atualizada
     */
    function stepPressurizacaoSimulation(devices) {
        if (!Array.isArray(devices) || devices.length === 0) return false;
        let hasSimulated = false;

        devices.forEach((dev) => {
            if (dev.isSimulated) {
                hasSimulated = true;
                if (!dev.ultima_leitura) {
                    dev.ultima_leitura = {
                        sensor1: 42.0,
                        rele1_on: 35.0,
                        rele1_off: 50.0,
                        rele1_acionamentos: 100,
                        rele1_estado: 0,
                        rele2_on: 32.0,
                        rele2_off: 50.0,
                        rele2_acionamentos: 25,
                        rele2_estado: 0,
                        timestamp: new Date().toISOString()
                    };
                }

                const l = dev.ultima_leitura;
                const r1_on = Number(l.rele1_on || 35.0);
                const r1_off = Number(l.rele1_off || 50.0);
                const r2_on = Number(l.rele2_on || 32.0);

                let currentP = Number(l.sensor1);
                let b1 = l.rele1_estado || 0;
                let b2 = l.rele2_estado || 0;

                if (b1 === 1 || b2 === 1) {
                    currentP += 1.6 + Math.random() * 0.4;
                    if (currentP >= r1_off) {
                        currentP = r1_off;
                        b1 = 0;
                        b2 = 0;
                    }
                } else {
                    currentP -= 0.5 + Math.random() * 0.3;
                    if (currentP <= r2_on) {
                        b1 = 1;
                        b2 = 1;
                        l.rele1_acionamentos = (l.rele1_acionamentos || 0) + 1;
                        l.rele2_acionamentos = (l.rele2_acionamentos || 0) + 1;
                    } else if (currentP <= r1_on) {
                        b1 = 1;
                        l.rele1_acionamentos = (l.rele1_acionamentos || 0) + 1;
                    }
                }

                l.sensor1 = Number(currentP.toFixed(1));
                l.rele1_estado = b1;
                l.rele2_estado = b2;
                l.timestamp = new Date().toISOString();

                if (currentP < 20.0) {
                    dev.status = 'Crítico';
                } else if (currentP > 65.0) {
                    dev.status = 'Atenção';
                } else {
                    dev.status = 'Operacional';
                }
            }
        });

        return hasSimulated;
    }

    global.SIMULATED_PRESSURIZACAO_DEVICES = SIMULATED_PRESSURIZACAO_DEVICES;
    global.stepPressurizacaoSimulation = stepPressurizacaoSimulation;
})(window);
