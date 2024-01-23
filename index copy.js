const { Client, LocalAuth } = require("whatsapp-web.js");
const { openai } = require("./lib/openai");
const fs = require("fs");
const { redis } = require("./lib/redis");
const socketIO = require("socket.io");
const express = require("express");
const { body, validationResult } = require("express-validator");
const qrcode = require("qrcode");
const http = require("http");
const axios = require("axios");
const { phoneNumberFormatter } = require("./helpers/formatter");
const cors = require("cors");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

const { MessageMedia } = require('whatsapp-web.js');






const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const token = "Bearer *!/0?;&okyE[)G4z;Zi},~VkS#~JO0QR";
const username = "adm";
const password = "adm";

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  })
);

function checkToken(request) {
  if (!request.headers["authorization"]) {
    return false;
  } else if (request.headers["authorization"] != token) {
    return false;
  } else {
    return true;
  }
}

const myId = "SingleDeviceX";

const authStrategy = new LocalAuth({
  clientId: myId,
});

const worker = `${authStrategy.dataPath}/session-${myId}/Default/Service Worker`;
if (fs.existsSync(worker)) {
  fs.rmSync(worker, { recursive: true });
}

//Client

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process", // <- this one doesn't works in Windows
      "--disable-gpu",
    ],
  },
  takeoverOnConflict: true,
  takeoverTimeoutMs: 10,
});

//Completion

async function completion(messages, forMe) {
  // if (forMe) {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    temperature: 0,
    max_tokens: 256,
    messages,
  });

  return completion.data.choices[0].message?.content;
  // }
  // return null;
}

// GPT/Message
client.on("message", async (message) => {
  const storeName = process.env.STORE_NAME || "Store";
  const chat = await message.getChat();

  if (!message.body || chat.isGroup) return;

  const customerPhone = `+${message.from.replace("@c.us", "")}`;
  const customerName = message.author;
  const orderCode = `#sk-${("00000" + Math.random()).slice(-5)}`;
  const customerKey = `customer:${customerPhone}:chat`;
  const lastChat = JSON.parse((await redis.get(customerKey)) || "{}");

  // Envia uma requisição get para o wordpress
  const data = await axios({
    method: "get",
    url: "https://iabuild.com.br/wp-json/jet-cct/assistente?_ID=1",
  });
  console.log(data.data.prompt);


  const customerChat =
    lastChat?.status === "open"
      ? lastChat
      : {
          status: "open",
          orderCode,
          chatAt: new Date().toISOString(),
          customer: {
            name: customerName,
            phone: customerPhone,
          },
          messages: [
            {
              role: "system",
              content: `Você é uma assistente virtual de atendimento de uma pizzaria chamada ${storeName}. Você deve ser educada, atenciosa, amigável, cordial e muito paciente.

        Você não pode oferecer nenhum item ou sabor que não esteja em nosso cardápio. Siga estritamente as listas de opções.
        
        O código do pedido é: ${orderCode}
        
        ${data.data.prompt}
        `,
            },
          ],
          orderSummary: "",
        };

  console.debug(customerName, "👤", message.body);
  

  chat.sendStateTyping();

  customerChat.messages.push({
    role: "user",
    content: message.body,
  });

  const content =
    (await completion(customerChat.messages, true)) ||
    process.env.CUSTOMER_NEGATIVE_MESSAGE ||
    "Não entendi";

  customerChat.messages.push({
    role: "assistant",
    content,
  });

  console.debug(customerPhone, "🤖", content);

  setTimeout(async () => {
    await client.sendMessage(message.from, content);
  }, 8000);

  if (customerChat.status === "open" && content.match(customerChat.orderCode)) {
    customerChat.status = "closed";

    customerChat.messages.push({
      role: "user",
      content: process.env.CUSTOMER_CHAT_MESSAGE,
    });

    const content =
      (await completion(customerChat.messages, true)) ||
      process.env.CUSTOMER_NEGATIVE_MESSAGE;

    console.debug(customerPhone, "📦", content);

    customerChat.orderSummary = content;
    redis.set(customerKey, JSON.stringify({}));
    return;
  }
  redis.set(customerKey, JSON.stringify(customerChat));
});

client.initialize();

// Socket IO
io.on("connection", function (socket) {
  socket.emit("message", "Conectando...");

  client.on("qr", async (qr) => {
    console.log("QR RECEIVED", qr);
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit("qr", url);
      socket.emit("message", "QR Code recebido, scaneie para conectar!");
    });
  });

  client.on("authenticated", () => {
    socket.emit("authenticated", "Whatsapp está autenticado!");
    socket.emit("message", "Whatsapp está autenticado!");
    console.log("AUTHENTICATED");
  });

  client.on("auth_failure", function (session) {
    socket.emit("message", "Autenticação falhou, restartando...");
  });

  client.on("ready", async () => {
    socket.emit("ready", "Whatsapp está pronto!");
    socket.emit("message", "Whatsapp está pronto!");
  });

  client.on("disconnected", (reason) => {
    socket.emit("message", "Whatsapp foi desconectado!");
    client.destroy();
    client.initialize();
  });
});

const checkRegisteredNumber = async function (number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
};

// Login
app.get("/", (req, res) => {
  res.sendFile("./html/login.html", {
    root: __dirname,
  });
});

// Qrcode
app.post("/app", (req, res) => {
  if (req.body.username == username && req.body.password == password) {
    res.sendFile("./html/index.html", {
      root: __dirname,
    });
  } else {
    let string = "Login falhou!";
    res.redirect("/?message=" + string);
  }
});

// Send message
app.post(
  "/send-message",
  [body("number").notEmpty(), body("message").notEmpty()],
  async (req, res) => {
    var status = checkToken(req);
    if (status == false) {
      return res.status(422).json({
        status: false,
        message: "Seu token está errado ou vazio.",
      });
    }
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;

    
    
    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: "O número nao está registrado.",
      });
    }

    client
      .sendMessage(number, message)
      .then((response) => {
        res.status(200).json({
          status: true,
          response: "Mensagem enviada com sucesso!",
        });
      })
      .catch((err) => {
        res.status(500).json({
          status: false,
          response: err,
        });
      });
  }
);

//Status
app.get("/status", async (req, res) => {
  res.sendFile("./html/status.html", {
    root: __dirname,
  });
});

server.listen(port, function () {
  console.log("App running on *: " + port);
});




// Adiciona função de multiplos destinatarios

app.use(cors({
  origin: ["http://iabuildtest.local"],
}));





// Envio de imagem 
const path = require('path');
const bodyParser = require('body-parser');
const storage = multer.memoryStorage();
const csv = require('csv-parser');

// ...
app.use(bodyParser.urlencoded({ extended: true }));
// Defina a rota para servir o arquivo HTML
app.get('/enviar-imagem', (req, res) => {
  res.sendFile(path.join(__dirname, '/html/enviar-imagem.html'));
});


// Rota para enviar mensagens com imagem via CSV ou números diretamente
app.post("/send-message-with-csv", upload.single('csvFile'), async (req, res) => {
  const status = checkToken(req);
  if (!status) {
    return res.status(422).json({
      status: false,
      message: "Seu token está errado ou vazio.",
    });
  }

  const numbers = [];

  // Verifica se há um arquivo CSV
  if (req.file && req.file.buffer) {
    const csvData = req.file.buffer.toString('utf-8');

    // Processa o conteúdo do arquivo CSV
    console.log('CSV Content:', csvData);

    await new Promise((resolve, reject) => {
      const stream = Readable.from(csvData);
      stream.pipe(csv())
        .on('data', (row) => {
          if (row.number) {
            numbers.push(row.number.trim());
          }
        })
        .on('end', () => {
          console.log('Numbers from CSV:', numbers);
          resolve();
        })
        .on('error', (error) => {
          console.error('Error processing CSV:', error);
          reject(error);
        });
    });
  } else {
    // Se não há arquivo CSV, verifica se há números fornecidos diretamente no campo de texto
    const providedNumbers = req.body.numbers;

    if (providedNumbers) {
      numbers.push(...providedNumbers.split(',').map(number => number.trim()));
      console.log('Numbers from Textarea:', numbers);
    }
  }

  const errors = validationResult(req).formatWith(({ msg }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped(),
    });
  }

  const messagesPromises = numbers.map(async (number) => {
    const formattedNumber = phoneNumberFormatter(number);
    const isRegisteredNumber = await checkRegisteredNumber(formattedNumber);

    if (!isRegisteredNumber) {
      return {
        status: false,
        message: `O número ${formattedNumber} não está registrado.`,
      };
    }

    const media = await MessageMedia.fromUrl(req.body.image);

    return client.sendMessage(formattedNumber, media, { caption: req.body.message })
      .then(() => {
        return {
          status: true,
          message: `Mensagem com imagem enviada com sucesso para ${formattedNumber}!`,
        };
      })
      .catch((err) => {
        return {
          status: false,
          message: `Erro ao enviar mensagem para ${formattedNumber}: ${err}`,
        };
      });
  });

  Promise.all(messagesPromises)
    .then((results) => {
      res.status(200).json(results);
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        message: err,
      });
    });
});