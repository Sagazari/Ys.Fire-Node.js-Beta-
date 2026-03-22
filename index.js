const express = require("express");
const fetch = require("node-fetch");

const app = express();

const CLIENT_ID = "1353210073832357992";
const CLIENT_SECRET = "vmje0_gLlcEhMnO9Njz9zSLOYzcXqBPp";
const REDIRECT_URI = "https://termsarch-ez.onrender.com/auth/callback";

app.get("/login", (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify guilds`;
    res.redirect(url);
});

app.get('/auth/callback', (req, res) => {
    const code = req.query.code;

    // 🔥 REDIRECIONA PRO SEU DASHBOARD
    res.redirect(`https://termsarch-ez.onrender.com/dashboard.html?code=${code}`);
});

    if (!code) return res.send("Erro: sem código");

    const params = new URLSearchParams();
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", REDIRECT_URI);

    const response = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
    });

    const data = await response.json();

    console.log(data);

    res.redirect("https://termsarch-ez.onrender.com/dashboard.html");
});

app.listen(3000, () => console.log("Rodando"));
