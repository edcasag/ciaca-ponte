# Monitoramento contínuo de uma passarela: indicadores por sensor para o modelo IFC

Simulador virtual do monitoramento contínuo de uma passarela metálica de pedestres. Pessoas atravessam ao longo do dia, com picos de fluxo. Depois de cada travessia, com a passarela vazia, o trecho de vibração livre é identificado pela FFT. Por dia, cada sensor (`Sensor_ID`) recebe um estado: BASELINE, NORMAL, ATENÇÃO ou ALERTA. Os indicadores resumidos formam um *snapshot* para um conjunto de propriedades (Pset) do sensor no modelo IFC, e as séries temporais ficam no banco de dados.

A passarela, o fluxo de pessoas, os acelerômetros, a temperatura e uma perda de rigidez são simulados. Não há conexão com a estrutura real.

**Pergunta:** os indicadores que vão para o IFC distinguem uma perda de rigidez da variação causada pela temperatura?

## Como executar

Abra `index.html` no navegador. Não é preciso servidor nem instalação.

1. **Parâmetros:** edite os valores, inclusive o perfil de travessias por hora, e clique em Simular. Os 60 dias levam alguns segundos.
2. **Resultados:**
   - figura com temperatura, frequência dominante e estado diário pelos dois critérios;
   - figura com o fluxo e as medições por hora do dia;
   - indicadores por sensor e volume de dados.

   As duas figuras podem ser baixadas em PNG, em tons de cinza.
3. **Painel do gêmeo:** estado de cada `Sensor_ID` no último dia com medição, o *snapshot* para o IFC e os arquivos para baixar.
4. **Ensaio virtual:** abre com uma demonstração de cerca de 1,5 min a 1×: uma pessoa, duas juntas, duas em sentidos opostos, um grupo de quatro e um grupo grande. No cenário "Hora do dia", anima uma hora escolhida, com as mesmas travessias do monitoramento; as velocidades de 5×, 20× e 60× ajudam a percorrer a hora. Mostra as pessoas atravessando e o tabuleiro vibrando (deformação ampliada). Embaixo, a vibração aparece parada, como uma corda de violão: a faixa mostra a oscilação no último 0,5 s e, sob cada sensor, a barra indica a oscilação atual e os traços o máximo desde o início, com os limites do Sétra. O quadro indica quando há um trecho de vibração livre em medição.

`testes.html` roda os testes automáticos do motor.

## Calibração

Modos, amortecimento e amplitudes por sensor vêm do trecho de vibração livre de um ensaio real (três acelerômetros, 1.000 Hz, de 402,4 a 406,5 s). O vão de 11,95 m vem do comprimento das vigas no modelo IFC.

| Sensor_ID | Canal | Posição | Amplitude a 7,93 Hz (g) | Amplitude a 9,77 Hz (g) |
|---|---|---|---:|---:|
| ACC_MV_01 | A1272_18A | Meio do vão | 0,04988 | 0,01969 |
| ACC_QV_01 | A1274_18A | 1/4 do vão | 0,02930 | 0,01155 |
| ACC_AP_01 | A1275_18A | Apoio | 0,00121 | 0,00051 |

- **Amortecimento** (estimado pela envoltória de cada modo): 1,47% a 7,93 Hz e 1,07% a 9,77 Hz.
- **Modelo numérico de referência:** 6,914 Hz.

## Modelo

**Fluxo de pessoas**
- Travessias por hora sorteadas (Poisson) a partir de um perfil diário. O padrão tem a madrugada vazia e picos às 8 h, às 13 h e às 18 h. Somam cerca de 310 travessias e 745 pessoas por dia.
- O grupo tem uma pessoa mais um número de extras (Poisson). A média de extras é de 0,3 fora de pico e chega a 2 na hora de maior fluxo.
- O peso de cada pessoa é sorteado em torno de 70 kg (desvio de 12 kg). O passo, de 1,6 a 2,2 Hz, é o mesmo para todo o grupo, com passada de 0,7 m.

**Medição**
- Vale o trecho logo após uma travessia, desde que ninguém entre na passarela por uma janela inteira (4,1 s).
- Por padrão, analisa-se no máximo um trecho por hora.
- De madrugada não há travessia, logo não há medição. Com fluxo muito alto, também pode faltar trecho livre.

**Vibração livre**
- A amplitude cresce com o peso total do grupo que acabou de passar, com dispersão log-normal de 0,25.
- O ruído do acelerômetro é de 0,3 mg.

**Temperatura**
- O ar tem ciclo diário de ±6 °C, oscilação de ±1,5 °C a cada 9 dias e aquecimento de 4 °C no período, em torno de 22 °C.
- A estrutura acompanha o ar com 2 h de atraso, e o termômetro tem erro de 0,5 °C.
- Na frequência, o efeito é de −0,1% por °C (Moser e Moaveni, 2011), mais 0,05% de variação entre medições.

**Perda de rigidez**
- 1% em rampa do dia 40 ao 50. A frequência é proporcional à raiz da rigidez, então cai cerca de 0,5%.

**Ensaio virtual (animação)**
- Cada passo é um impulso proporcional ao peso e à forma do modo, sen(πx/L), no ponto pisado. A resposta de cada sensor é a soma das respostas impulsivas amortecidas dos dois modos.
- A escala é ajustada para que uma pessoa de peso médio produza 0,08 g no meio do vão. Esse valor é estimado e deve ser calibrado pelo registro do ensaio.
- As pessoas de um grupo andam em sincronia, o que tende a superestimar o pico em grupos grandes.

## Identificação

Segue o mesmo método do ensaio:
1. Remoção da média.
2. Janela de Hamming.
3. *Zero-padding* até a próxima potência de 2.
4. FFT de 0 a 50 Hz.
5. Maior pico acima de 1 Hz.

Extensão opcional: interpolação parabólica do pico. Com 4,1 s de sinal, a grade da FFT tem 0,12 Hz, enquanto o efeito da temperatura é de cerca de 8 mHz por °C. Sem a interpolação, a variação diária fica abaixo da resolução.

## Critério de estado

| Estado | Condição |
|---|---|
| BASELINE | primeiros 14 dias: aprende a média e o desvio (σ) das médias diárias |
| NORMAL | média diária dentro de ±2σ |
| ATENÇÃO | média diária fora de ±2σ |
| ALERTA | fora de ±3σ em dois dias seguidos (persistência) |

Um dia sem medição repete o estado anterior.

Os dois critérios usam a mesma simulação:

- **sem compensação:** média diária da frequência;
- **com compensação:** resíduo da regressão entre frequência e temperatura, ajustada com as médias diárias da linha de base.

## Resultados com os parâmetros padrão (semente 2026)

| Sensor_ID | Erro de f, grade (mHz) | Erro de f, interpolação (mHz) | Sem compensação: ATENÇÃO / ALERTA falsos | Sem compensação: detecção | Com compensação: ATENÇÃO / ALERTA falsos | Com compensação: detecção |
|---|---:|---:|---:|---:|---:|---:|
| ACC_MV_01 | 36,9 | 1,4 | 4 / 2 | 6 dias | 2 / 0 | 3 dias |
| ACC_QV_01 | 36,9 | 1,4 | 4 / 2 | 6 dias | 2 / 0 | 3 dias |
| ACC_AP_01 | 37,2 | 4,2 | 5 / 0 | 6 dias | 1 / 0 | 3 dias |

- **Falsos:** dias em ATENÇÃO ou ALERTA antes da perda de rigidez.
- **Detecção:** dias do início da perda de rigidez até o fim do primeiro dia em ALERTA.
- **Medições:** 18 por dia; nenhuma da 0 h às 4 h.
- **Efeito da temperatura estimado:** −7,2 mHz/°C, contra −7,9 mHz/°C simulados. Como as medições se concentram no período do dia, a média diária ainda carrega parte do atraso térmico.

| Dado por dia (3 sensores) | Volume | Onde fica |
|---|---:|---|
| Série contínua a 1.000 Hz | 1,04 GB | não armazenada |
| Trechos de vibração livre medidos | 0,89 MB | banco de dados |
| *Snapshot* (frequência, RMS e estado por `Sensor_ID`) | cerca de 500 bytes | modelo IFC (Pset) |

## Saídas

- **PNG das figuras,** em tons de cinza, para publicação.
- **`snapshot_ifc.json`:** por `Sensor_ID`: `LastDominantFrequency`, `LastCorrectedFrequency`, `LastRMS`, `LastStatus`, `LastZ` e `LastUpdate`.
- **`sensors.json`:** segue o formato da plataforma Web da passarela (visualizador IFC com painel do sensor). Copiado para a pasta `data/` da plataforma, mostra o estado simulado de cada sensor, com o sinal, o espectro e os picos da última medição.
- **`eventos.csv`:** uma medição por linha e sensor, com dia, temperatura medida, frequência simulada, frequência na grade, frequência interpolada e RMS.
- **`parametros.json`:** os parâmetros usados.

## Uso do motor

`motor.js` não tem dependências. Funciona no navegador (`window.Motor`) e em CommonJS:

```js
const r = Motor.simular(Motor.PARAM_PADRAO);
r.sensores[0].ind.com.atraso_dias;   // dias até o ALERTA, com compensação
r.fluxo.por_hora;                    // travessias, pessoas e medições por hora do dia
r.pset;                              // snapshot para o IFC
r.snapshot;                          // sensors.json da plataforma
const e = Motor.ensaioVirtual(Motor.PARAM_PADRAO, 0, 8);   // dia 1, 8 h
Motor.pessoasNoInstante(e, 120);     // posição de cada pessoa aos 120 s
Motor.ensaioDemo(Motor.PARAM_PADRAO);  // demonstração com grupos típicos (106 s)
```

`passarela_padrao.json` é uma cópia de `Motor.PARAM_PADRAO`.

## Referência

Moser, P., & Moaveni, B. (2011). Environmental effects on the identified natural frequencies of the Dowling Hall Footbridge. *Mechanical Systems and Signal Processing, 25*(7), 2336-2357. https://doi.org/10.1016/j.ymssp.2011.03.005
