const express = require('express');
const axios = require('axios');
const cors = require('cors')
const app = express();
app.use(cors());

const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
app.use(express.json());
const swaggerDocument = YAML.load(path.join(__dirname, './swagger.yaml'));

const FLIGHT_LIMITS = {
    'OK123': 100,
    'US999': 5000
};

let bags = [];

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ENDPOINTY 

// vytvoreni kufru
app.post('/bag', (req, res) => {
    const { owner, flight, weight } = req.body;

    function getFlightWeight(flightCode) {
        let total = 0;
        for (const bag of bags) {
            if (bag.flight === flightCode) {
                total += bag.weight;
            }
        }
        return total;
    }

    const currentWeight = getFlightWeight(flight);

    const maxWeight = FLIGHT_LIMITS[flight] || 2000;

    if (currentWeight + weight > maxWeight) {
        return res.status(409).json({ error: "Letadlo je přetížené!" });
    }

    const newBag = { id: Date.now(), owner, flight, weight, status: 'CHECKED_IN' };
    bags.push(newBag);

    console.log(`Odbaven kufr: ${owner}, let ${flight}, váha ${weight}kg, id ${newBag.id}`);
    res.status(201).json(newBag);
});



app.patch('/bag/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    const bag = bags.find(b => b.id == id);
    if (!bag) return res.status(404).send("Nenalezeno");

    bag.status = status; 
    // Logika rozhodování
    if (status === 'LOADED') sendWebhookWithRetry('bag_loaded', bag);
    if (status === 'UNLOADED') sendWebhookWithRetry('bag_arrived', bag);

    res.json(bag);
});

async function sendWebhookWithRetry(event, bag, pokus = 1) {
    try {
        await axios.post('http://127.0.0.1:8080/webhook-receiver', { 
            event: event,
            timestamp: new Date().toISOString(),
            data: bag
         });
        console.log("Webhook doručen.");
    } catch (error) {
        if (pokus <= 3) {
            console.log(`Chyba! Zkusím to znovu za 2 sekundy (Pokus ${pokus}/3)`);
            setTimeout(() => sendWebhookWithRetry(event, bag, pokus + 1), 2000);
        } else {
            console.error("Webhook se nepodařilo doručit ");
        }
    }
}

// vyzvednuti
app.post('/bag/collected', (req, res) => {
    const { bagId } = req.body;
    console.log(` Pasažér si vyzvedl kufr ${bagId}`);
    res.sendStatus(200);
});

app.listen(3000, () => {
    console.log('ALPHA běží na http://localhost:3000');
});