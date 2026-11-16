# Metrics Viewer

Viewer locale per metriche MATLAB, con stile derivato da TimeSeriesViewer del Behavior & Brain Lab. Nessun backend, nessun upload e nessuna dipendenza da CDN. Il campo `Fs` non viene utilizzato.

## Avvio

Aprire `index.html` nel browser, oppure eseguire `npm start` (Node.js) e aprire `http://127.0.0.1:8080`. Il pulsante **Prova un esempio** genera sei soggetti sintetici con durate e passi temporali differenti. I dati caricati rimangono in memoria fino alla chiusura/ricarica della pagina.

L'app ha due schede principali, **Serie temporali** e **Riepilogo temporale**. Dopo il caricamento, in entrambe puoi scegliere **Visualizzatore** o **Analisi statistiche**. Normalizzazione, metrica, baseline e selezione soggetti sono condivise. Quando scegli una normalizzazione, il selettore Epoca baseline compare accanto. Nelle Serie temporali il menu Stimolo / epoca seleziona una singola epoca. Nel Riepilogo temporale la barra in alto parte da Aggregazione nel tempo e il menu Stimolo / epoca permette di selezionare più epoche. Questi controlli rimangono accessibili sia in Visualizzazione sia in Analisi statistiche. Le epoche selezionate determinano il confronto nel riepilogo e la famiglia di test statistici. La ricerca filtra le opzioni senza modificare la selezione. Il campo di ricerca è all’interno del menu aperto; frecce, Invio ed Escape permettono di operare da tastiera.

## Esportazione interattiva da MATLAB

Aggiungere la cartella `matlab` al percorso MATLAB e lanciare:

```matlab
exportMetricsJSON
```

1. Selezionare uno o più file MAT. Sono riconosciute variabili struct, array di struct e cell array di struct, incluso `cell_out`.
2. Scegliere nome e cartella del JSON. Tutti i soggetti caricati vengono inclusi senza una seconda selezione.

Annullare una finestra interrompe l'operazione senza scrivere file. Si deve scegliere una sola registrazione per soggetto. L'export conserva i campioni e i tempi, non applica normalizzazione o aggregazione.

Per partire da variabili già presenti nel workspace:

```matlab
exportMetricsJSON(S)                      % tutti i soggetti forniti e salvataggio
exportMetricsJSON({S1, S2, S3})           % nessun cellarray aggregato preliminare necessario
exportMetricsJSON(S, "subject.json")     % senza finestre
exportMetricsJSON(cell_out, "group.json") % senza finestre
D = exportMetricsJSON(S, "", Interactive=false); % restituisce il dataset, non salva
exportMetricsJSON(cell_out, "group.json", Interactive=true); % tutti i soggetti forniti
```

Richiede MATLAB R2021a o successivo, senza toolbox aggiuntivi. Verificato con R2025b.

## Formato JSON v1

```json
{
  "schema_version": 1,
  "time_unit": "s",
  "recordings": [
    {
      "id": "SBJ_01",
      "subject": "SBJ_01",
      "metadata": {"date": "06-NOV-2026"},
      "epochs": [
        {
          "id": "baseline",
          "metrics": {
            "AWI": {"time": [0, 0.5, 1], "values": [1, 2, 3]}
          }
        },
        {
          "id": "task1",
          "metrics": {
            "AWI": {"time": [0, 0.5, 1, 1.5], "values": [2, 4, null, 3]}
          }
        }
      ]
    }
  ]
}
```

- `recordings`, `epochs`, `time` e `values` sono sempre array, anche con un solo elemento.
- Ogni `id` di registrazione e ogni `subject` sono unici nel dataset importato. Ogni epoca ha un ID unico all'interno della registrazione. Più file vengono aggiunti in modo atomico: un errore non modifica il dataset esistente. Duplicati rifiutati, non sovrascritti.
- `time` contiene secondi dall'inizio dell'epoca, finiti, non negativi e strettamente crescenti. Non deve necessariamente contenere un campione a zero: il primo campione non viene spostato.
- `time` e `values` hanno la stessa lunghezza. Sono consentite serie vuote, metrica/epoca assente in un soggetto e durate/passaggi temporali differenti.
- `values` ammette numeri finiti e `null`. L'esportatore converte NaN/Inf in `null`, mantenendo i tempi e le posizioni; i tempi non finiti sono rifiutati.
- `metrics.<nome>{k}` e `metrics_time.<nome>{k}` della struct MATLAB sono associati a `epoch_id(k)`. Per ciascuna metrica devono esserci tante celle quante epoche.
- `Fs`, dati EEG grezzi, percorsi locali e canali non sono necessari per questo formato. Sono conservati come metadati solo `date` e `origin`, quando presenti.

Nessun limite fisso in MB per i JSON importati. Lettura e parsing avvengono in memoria nel browser: la dimensione gestibile dipende dalla memoria disponibile e dai dati. La griglia di allineamento resta limitata a 50.000 istanti e 2 milioni di celle soggetto × tempo; aumentare il passo per griglie più grandi.

## Normalizzazione e riepiloghi

Per la metrica selezionata, la normalizzazione viene precalcolata su tutte le epoche e tutti i soggetti e riutilizzata dalle due modalità. Cambiare epoca visualizzata, selezione dei soggetti, intervallo di analisi o griglia non ricalcola la normalizzazione. Cambiare dati, metrica, metodo, baseline, intervallo baseline o scala MAD invalida il risultato memorizzato.

Per ogni soggetto e metrica le statistiche sono stimate sui campioni originali della baseline selezionata, eventualmente limitata dall'intervallo baseline:

- z-score: `(x - mediaBaseline) / sdBaseline`, con deviazione standard campionaria, denominatore N−1.
- z-MAD: `(x - medianaBaseline) / MAD`, con MAD grezza oppure moltiplicata per 1,4826 (predefinita).
- Variazione percentuale: `100 * (x - mediaBaseline) / mediaBaseline`. Si conserva il segno della media baseline.

Campioni null esclusi dalle statistiche. Baseline mancante, vuota, con SD/MAD/media nulla o insufficienti campioni: serie non utilizzabile, con avviso; nessuna sostituzione silenziosa con zeri. Non vengono condivise baseline tra soggetti o metriche.

Il riepilogo temporale usa i campioni originali normalizzati nell'intervallo di analisi: media dei campioni, mediana, media pesata per durata, deviazione standard, minimo o massimo. La media pesata integra trapezi tra campioni validi, ritaglia i segmenti sui limiti dell'intervallo ed esclude lacune; riporta la durata valida nel CSV. Non richiede una griglia comune.

## Allineamento temporale

La griglia è ancorata allo zero dell'epoca. **Intervallo comune** usa la sovrapposizione delle coperture temporali; **intervallo completo** conserva le code, con null per i soggetti terminati e N effettivo a ogni istante.

Il passo automatico è il massimo dei passi mediani delle serie utilizzabili; il passo manuale è in secondi. Il metodo di interpolazione è lineare o più vicino. Non si estrapola. I null interrompono l'interpolazione; la soglia predefinita per le lacune è tre volte il passo mediano della singola serie, modificabile manualmente. La soglia lacune vale anche per le medie pesate.

Nel downsampling si usa un filtro boxcar temporale di larghezza pari al passo finale, integrato sui tempi nativi. Questo semplice filtro attenua le alte frequenze, ma non è un anti-aliasing ideale; le finestre ai bordi sono troncate. Se una finestra attraversa dati mancanti o lacune eccessive, il risultato è null. L'allineamento è in tempo reale, non in percentuale della durata.

## Outlier

I metodi puntuali sono recuperati da `TimeSeriesViewer/js/data.js` e conservati in `js/outliers.js`. Il confronto è sempre tra soggetti per la stessa metrica ed epoca, dopo normalizzazione. Le soglie usano tutti i soggetti caricati e utilizzabili, indipendentemente dalla selezione manuale, come nell'app originale.

**Time series**:

- IQR: limiti Q1−1,5×IQR / Q3+1,5×IQR a ciascun istante confrontabile.
- MAD: z robusto `0.6745 * abs(x - mediana) / MAD > 3.5`.
- Minimo 5 soggetti a ogni istante. Un soggetto è segnalato con almeno 3 istanti devianti e almeno il 10% degli istanti valutabili; N/D con meno di 3 istanti valutabili.
- Media temporale IQR: IQR tra medie pesate native, almeno 5 medie valide. Rispetto all'originale, le lacune ora sono escluse dall'integrale.
- Per passi differenti i confronti puntuali usano la griglia comune sull'unione delle coperture, limitata all'intervallo di analisi.

**Riepilogo temporale**:

- IQR o MAD sul valore individuale restituito dalla funzione di aggregazione selezionata, separatamente per ogni epoca.
- Almeno 5 riepiloghi validi. Non si applicano le soglie temporali del 10% e dei 3 istanti: ogni soggetto ha un valore per epoca.
- La tabella individuale e il CSV riportano un flag per soggetto × epoca. I badge laterali riassumono le epoche selezionate: Sì (N) se il soggetto è outlier in almeno un’epoca, No se non ci sono flag nelle epoche valutabili, N/D se nessuna epoca è valutabile. Il tooltip elenca epoche segnalate ed eventuali epoche non valutabili. Il selettore della singola epoca è visibile solo nelle time series.

MAD nulla: un valore diverso dalla mediana oltre la tolleranza numerica è segnalato; valori uguali non lo sono. I flag **non escludono automaticamente nessuno**. I controlli di selezione determinano chi contribuisce ai grafici e ai test. Nel pannello Campione, **◎** evidenzia una singola traccia e attenua le altre, come in TimeSeriesViewer. **Isola outlier (N)** evidenzia gli outlier tra i soggetti selezionati per la metrica/epoca corrente nelle time series; nel riepilogo considera l’unione degli outlier delle epoche selezionate. Durante l’isolamento la lista Soggetti mostra solo gli outlier evidenziati. Lo stesso pulsante diventa **Ripristina vista** e ripristina la lista completa. Questi comandi sono solo visivi: non modificano selezione, medie, CSV o risultati statistici. Quando non ci sono outlier selezionati il pulsante collettivo è disabilitato. Cambiare metrica, epoca o impostazioni di calcolo ripristina la vista; deselezionare un soggetto isolato annulla l’isolamento.

## Analisi statistiche

In **Opzioni → Campione statistico**, gli outlier sono evidenziati in giallo. Spunta un soggetto per escluderlo dai test. I soggetti deselezionati in **Soggetti** compaiono già spuntati. Per escludere in blocco gli outlier visibili, usa **Isola outlier** nella lista **Soggetti** e poi **Escludi dai test**. Le esclusioni valgono per tutte le analisi del dataset aperto e quelle esplicite compaiono nel CSV statistico. **Annulla esclusioni manuali** rimuove le esclusioni applicate ai soli test.

Il motore deriva da `TimeSeriesViewer/js/permutation.js` e preserva:

- Test a un campione: statistica t contro un valore nullo, con sign-flipping dei residui per soggetto; test a due code.
- Gruppi indipendenti: F omnibus, con permutazione delle etichette dei soggetti e dimensioni dei gruppi conservate. I gruppi si creano e si assegnano nella sezione **Opzioni → Campione statistico**. Servono almeno due soggetti per gruppo. Nel riepilogo, i post-hoc identificano le coppie tramite permutazioni globali delle etichette e correzione congiunta max-|T| su coppie × epoche.
- Stessa trasformazione del soggetto a tutti gli istanti/epoche in ogni permutazione, preservando la dipendenza entro soggetto.
- P-value puntuale e corretto max-|T| / max-F, con correzione Monte Carlo `(eccedenze + 1) / (permutazioni + 1)`.

Nel viewer temporale la famiglia comprende tutti gli istanti analizzati della metrica × epoca selezionata. Si mantengono solo istanti validi per tutti i soggetti con una serie utilizzabile; il numero di istanti omessi è riportato.

Nel riepilogo il disegno predefinito è **Epoche degli stessi soggetti · appaiato / misure ripetute**. Le checkbox determinano le epoche del confronto. Si usano solo soggetti con riepiloghi validi in tutte le epoche selezionate, mantenendo l’abbinamento per ID; i soggetti esclusi sono elencati. Omnibus, post-hoc e grafici statistici usano lo stesso insieme di soggetti completi.

- **Due epoche:** statistica t sulle differenze individuali A − B, test a due code mediante cambi di segno per soggetto. Un solo confronto, quindi p grezzo e p finale coincidono.
- **Tre o più epoche:** statistica F a un fattore entro soggetto, con rimozione dell’effetto del soggetto. La distribuzione nulla è ottenuta permutando le etichette delle epoche separatamente entro ciascun soggetto. Il p omnibus è un singolo test e non richiede correzione multipla.
- **Post-hoc:** tutte le K(K−1)/2 coppie delle epoche selezionate, statistiche t appaiate a due code. Ogni permutazione applica lo stesso segno a tutte le differenze di un soggetto, preservando la dipendenza tra contrasti. Il massimo |T| su tutte le coppie genera i p-value corretti per la famiglia. I post-hoc sono riportati anche se l’omnibus non è significativo; la correzione max-|T| riguarda la famiglia dei post-hoc, non unisce l’omnibus alla famiglia.
- **Output:** statistiche, differenza media A − B, N, p grezzi e finali, correzione applicata. Il CSV aggiunge epoche A/B, gradi di libertà descrittivi, soggetti inclusi/esclusi, normalizzazione, aggregazione, seed e numero di permutazioni. L’ordine A/B segue quello delle epoche nell’app ed è esplicito in tabella/CSV.

Il numero scelto indica le permutazioni **per fase**: con almeno tre epoche, B per l’omnibus e B per i post-hoc congiunti. L’avanzamento copre entrambe le fasi; seed e annullamento sono supportati. Tutti i p-value Monte Carlo usano `(eccedenze + 1) / (B + 1)`, senza riferimento alle distribuzioni teoriche t/F.

I disegni preesistenti contro valore nullo e tra gruppi indipendenti rimangono disponibili: in questi casi si testa separatamente ogni epoca, correggendo su tutte le epoche selezionate, e non si confrontano le epoche tra loro.

La famiglia non comprende metriche diverse o esecuzioni separate. Non si assume normalità per i p-value, ma sono necessari soggetti indipendenti e trasformazioni valide sotto il nullo. Il cambio di segno appaiato richiede simmetria delle differenze; per max-|T| serve simmetria congiunta del vettore dei contrasti nulli rispetto al cambio di segno per soggetto. L’omnibus richiede scambiabilità delle epoche entro soggetto sotto il nullo: non è automaticamente valido per strutture arbitrarie di dipendenza o varianze diverse tra epoche. Nei test preesistenti lo scambio dei gruppi richiede scambiabilità tra gruppi. Selezione manuale e flag non correggono questi presupposti. Gli IC 95% delle barre restano descrittivi basati su t di Student e non sono IC simultanei o IC delle differenze appaiate.

Riferimento per gli schemi di permutazione appaiati: [documentazione SciPy, permutation_test](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html).

Novità: seed riproducibile, annullamento e invalidazione dei risultati quando cambiano dati/impostazioni; limite del carico di calcolo con messaggio esplicito. I grafici statistici mostrano medie per gruppo e IC 95% t (stessa tabella critica dell'originale), oltre ai p-value corretti. Il CSV riporta selezioni, normalizzazione, gruppi, seed e parametri del test. I grafici descrittivi mostrano la media tra soggetti con IC 95% t di Student, come banda nelle serie temporali e come barre nel riepilogo. Clic su un punto oppure il pulsante di isolamento evidenzia il soggetto in tutte le epoche. Le analisi statistiche mantengono barre con IC 95% t di Student. Gli IC non sono corretti per confronti multipli e non vengono mostrati con meno di due soggetti. I valori individuali restano visualizzabili tramite isolamento; tabella e CSV includono i limiti degli IC del riepilogo.

## Sviluppo e verifica

```text
npm test
```

In ambienti che impediscono la creazione di processi Node:

```text
node --test --test-isolation=none tests/core.test.js tests/analysis.test.js
```

Test MATLAB:

```matlab
results = runtests("tests/ExportMetricsJSONTest.m");
assertSuccess(results)
```

I dati reali di ricerca non sono inclusi nella repository. `private-data/` e i MAT sono esclusi da Git.

L’esportatore parte dalla versione fornita dall’utente: usa `jsonencode` e mostra barre di avanzamento per lettura MAT, conversione e scrittura. Le barre si chiudono anche in caso di errore o annullamento; `Progress=false` le disabilita. Le misure della precedente implementazione non si applicano a questa versione.

## Avanzamento delle operazioni

Un popup modale indica le fasi di lettura e verifica dei JSON, preparazione dei grafici, ricerca outlier ed esportazione CSV. Le elaborazioni di dataset grandi (almeno 20.000 campioni della metrica o 100 registrazioni) mostrano anche le fasi di normalizzazione e allineamento. Il browser riceve tempo per disegnare il popup prima dei calcoli. I passaggi sincroni più costosi possono comunque occupare il thread principale; non viene mostrata una percentuale inventata.

Nei test statistici l’avanzamento mostra il numero effettivo di permutazioni completate. Il pulsante Annulla analisi (o Escape) interrompe il test al successivo blocco di permutazioni. Il popup si chiude anche in caso di errore e riporta il focus al controllo precedente.

L’esportatore include tutti i soggetti dei file selezionati, senza una seconda lista di selezione. Una metrica rappresentata da un singolo NaN (epoca troppo corta) viene esportata come serie vuota; se nell’epoca restano solo metriche non disponibili, l’epoca viene omessa per quel soggetto. I soggetti senza epoche restanti vengono omessi; se non rimane alcun soggetto, l’esportazione termina con un messaggio senza scrivere il file. Il numero di epoche omesse viene riportato nella Command Window.

Attiva la lente per ingrandire un’area trascinando sul grafico. Il pulsante accanto alla lente ripristina entrambi gli assi. Nelle barre sotto e a destra, trascina le estremità per regolare lo zoom o la parte centrale per spostare la finestra visibile. **Auto** ripristina l’intera scala dell’asse corrispondente. Gli intervalli impostati mantengono i loro limiti anche quando cambi i soggetti selezionati. Clicca una traccia individuale o un punto per evidenziare il soggetto nella lista.

Il clic fuori dai controlli di isolamento e dai punti interattivi, oppure Escape, ripristina la vista dei soggetti. Nei grafici statistici del riepilogo le parentesi collegano le coppie significative: * p finale <= 0,05, ** <= 0,01, *** <= 0,001. Per i post-hoc si usano i p corretti max-|T|; il p omnibus non determina le parentesi. Le annotazioni restano sopra il grafico anche con scala Y personalizzata.

Annotazioni statistiche del riepilogo: nel disegno entro soggetto le parentesi collegano epoche; per gruppi indipendenti collegano le barre dei gruppi nella stessa epoca; contro valore nullo compare un asterisco sulla singola barra. I post-hoc indipendenti usano statistiche t pooled a due code. A ogni permutazione le etichette di tutti i gruppi vengono riassegnate ai soggetti, conservando le numerosità; la stessa assegnazione vale in tutte le epoche. Il massimo |T| su tutte le coppie × tutte le epoche produce una sola distribuzione nulla e i p corretti, senza fattori Bonferroni. Anche i p grezzi provengono da questa permutazione globale. La famiglia dei post-hoc è separata dagli omnibus. Servono scambiabilità tra tutti i gruppi sotto il nullo globale e, per controllo forte sotto nulli parziali, la condizione di subset pivotality; distribuzioni o varianze diverse non sono automaticamente ammesse. B permutazioni congiunte per la fase post-hoc, non B per coppia. CSV: gruppi, epoche, differenza A-B, numerosità, p grezzo/finale e correzione.


## Video sincronizzato

Nella modalità **Time series**, apri **Associa video alle epoche** e scegli un video locale per ogni stimolo. Il lettore mostra automaticamente il video dell’epoca selezionata; puoi sostituire o rimuovere ogni associazione.

Lo zero del video coincide con lo zero dell’epoca. Nei grafici temporali, trascina il riquadro con i secondi o la fascia sull’asse dei tempi per spostarti nel video. Con la fascia a fuoco, le frecce destra e sinistra spostano il tempo di un secondo. La ricerca viene limitata alla durata del video. Fuori dall’intervallo visibile il cursore è nascosto.

Il cambio di epoca riparte da zero; il riepilogo temporale mette in pausa e nasconde il video. Cambiare metrica o filtri mantiene il tempo. I video restano locali, non vengono esportati nel JSON/CSV e devono essere riassociati al ricaricamento della pagina. Usa un formato e codec supportato dal browser (ad esempio MP4 o WebM).


### Momenti significativi e video

Le tabelle statistiche mostrano per impostazione predefinita solo i risultati con **p finale ≤ 0,05**; togli la spunta per consultare tutti i risultati. Il CSV mantiene tutti i risultati e i p-value corretti.

Dopo un’analisi Time series, **Momenti significativi nel video** raggruppa solo campioni significativi adiacenti sulla griglia originale; campioni non significativi o mancanti separano gli intervalli. Non è un test cluster-based e non implica significatività tra i campioni. Per ogni intervallo puoi andare al video, scaricare il **frame PNG al p minimo** o una **clip dal primo all’ultimo campione significativo**. Gli istanti isolati offrono il frame, senza inventare una durata significativa. Il riepilogo per epoca non produce intervalli temporali.

Associa prima il video dell’epoca, oppure aggiungilo dopo l’analisi. L’estrazione usa un lettore separato e non sposta quello principale. Le clip sono ricodificate localmente, con audio originale, a circa 30 fps in WebM o MP4 secondo il browser; la registrazione richiede la durata della clip e la scheda deve restare visibile. È possibile annullarla. Un intervallo non coperto dalla durata del video viene segnalato e non esportato. I file portano metrica, epoca e tempi nel nome. Nessun video viene caricato su un server.

Ogni intervallo dispone di un mini player con audio originale, play/pausa, ricerca limitata al segmento e volume. Parte un solo mini player alla volta. Gli istanti isolati mostrano un fotogramma con riproduzione disabilitata.


### Esempio con video già associati

**Prova file di esempio** carica i dati di `metrics_demo_2_stimoli.json` (35 soggetti sintetici, 10 metriche, incluse AWI_60Hz e WL_60Hz) e collega automaticamente i video di arancia, Coca-Cola e della baseline nera di 10 secondi. Parte dalla metrica AWI e dall’epoca arancia, senza normalizzazione. Funziona anche da `file://`: `js/demo-data.js` contiene una copia del JSON, verificata dai test. Per rigenerarla dopo una modifica del JSON, aggiornare il bundle prima di pubblicare. I tre MP4 devono restare nella cartella accanto a `index.html`. Vedi [DEMO_VIDEO.md](DEMO_VIDEO.md) per provare le analisi e i mini player.


### Estrazione descrittiva di istanti e clip

In **Time series → Visualizzazione → Estrai istanti e clip dal segnale** scegli la media dei soggetti selezionati oppure un singolo soggetto. Sono disponibili massimo/minimo globale e picchi/valli locali, ordinati per valore con distanza minima regolabile. Un plateau è un solo estremo; i bordi e le lacune non vengono trattati come picchi locali. Il calcolo usa la griglia temporale, la normalizzazione e l'intervallo correnti. Non è un test di significatività.

Imposta quanti picchi estrarre e i secondi prima/dopo l'istante. Le clip sono limitate ai tratti di dati continui. Ogni risultato offre mini player con audio, salto al video, frame PNG all'istante scelto e clip esportabile. Se il video non copre la finestra richiesta, l'esportazione lo segnala. Cambiando dati o criteri, i risultati precedenti vengono invalidati. L'estrazione è locale e richiede un video associato all'epoca.

Gli istanti estratti sono indicati da cerchi cliccabili sulla serie temporale. Clic oppure Invio/Spazio selezionano il risultato e posizionano il mini player sul relativo istante, anche in presenza di clip sovrapposte. Cambiando criteri o dati, i cerchi precedenti vengono rimossi.

I cerchi aprono anteprime numerate sotto il grafico. Il numero 1 indica il massimo più alto o il minimo più basso, secondo il criterio scelto. Le anteprime restano nell’ordine dei numeri e il grafico recupera tutto lo spazio quando le chiudi. Il numero collega il cerchio all’anteprima. Clic sul video o Invio/Spazio avvia o mette in pausa la riproduzione. **⋯** mostra i comandi di ricerca ed esportazione. **×** chiude l’anteprima. Un solo player alla volta riproduce audio.

I comandi **Soggetti** e **Media ± IC 95%** cambiano solo la visualizzazione e conservano le anteprime. Cambiando dati, epoca, metrica, normalizzazione o criteri, i risultati vengono invalidati.

La barra sopra il grafico trova massimi o minimi della media: con numero 1 seleziona l’estremo globale, con più risultati cerca gli estremi locali. Le clip includono un secondo prima e dopo, nei limiti del segnale. Nelle analisi statistiche le fasce verdi aprono anteprime numerate sotto il grafico. Il p finale determina quali intervalli mostrare. La numerazione parte dall’intervallo con la differenza massima più grande: distanza dal valore nullo per un campione, oppure distanza fra le medie dei gruppi. **Opzioni** contiene il tipo di test, le permutazioni, il seed e l’assegnazione ai gruppi. Il riepilogo riporta le scelte attive e le assegnazioni ai gruppi vengono conservate nella sessione del browser.
