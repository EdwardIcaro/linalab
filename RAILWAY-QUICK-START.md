# 🚀 Railway Quick Start - 15 Minute Setup

Ultra-condensed deployment guide. Read DEPLOY-RAILWAY.md for full details.

---

## 1. Open Railway (1 min)
- https://railway.app
- Login with GitHub
- Click "New Project" → "Deploy from GitHub repo"
- Select: `EdwardIcaro/linalab`

---

## 2. Add PostgreSQL (1 min)
- Click: "+ New" → "Database" → "PostgreSQL"
- Wait for provisioning (auto-adds DATABASE_URL)

---

## 3. Configure Variables (3 min)

Go to: **Service (Node.js) → Variables**

**Generate JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Copy-paste these variables:**
```
NODE_ENV=production
PORT=3001
JWT_SECRET=[PASTE_GENERATED_KEY_HERE]
BCRYPT_SALT_ROUNDS=12
SENDGRID_API_KEY=SG.get_from_sendgrid
EMAIL_FROM=noreply@yourdomain.com
FRONTEND_URL=${{RAILWAY_PUBLIC_DOMAIN}}
MERCADO_PAGO_ACCESS_TOKEN=TEST-5277956129999284-013022-a0433da8a4d2e282840ab5a3cd96efa0-182616510
MERCADO_PAGO_PUBLIC_KEY=TEST-2e6d0347-0e5c-40fe-8502-b371cd766ee2
MERCADO_PAGO_WEBHOOK_SECRET=db9ff2381b84a19f9c3ddd8e9e7fdf864277b6f65f4a12008a9ed1b3203e1b16
PAYMENT_SUCCESS_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_FAILURE_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_PENDING_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
```

---

## 4. Deploy (1 min)
- Click: "Deploy" (blue button)
- Wait for build to complete (5-10 min)
- Check logs for errors

---

## 5. Get Domain (1 min)
- Service → Settings → Domains
- Copy: `linax-production-xxxx.up.railway.app`

---

## 6. Setup SendGrid (3 min)

1. https://sendgrid.com → Sign up (free)
2. Settings → API Keys → Create API Key
3. Copy key into Railway: `SENDGRID_API_KEY`
4. **IMPORTANT:** Settings → Sender Authentication → Verify Single Sender (use your email)

---

## 7. Update Frontend URL (1 min)

File: `DESKTOPV2/api.js` line 1
```javascript
const API_BASE_URL = 'https://linax-production-xxxx.up.railway.app/api';
```

Commit:
```bash
git add DESKTOPV2/api.js
git commit -m "Update API URL to production"
git push
```

Railway auto-deploys. Wait ~5 min.

---

## 8. Test (2 min)

Open in browser:
```
https://linax-production-xxxx.up.railway.app/login.html
```

1. Signup test account
2. Check email (should arrive in 30s)
3. Login
4. Create company
5. Create customer
6. Create order

---

## 9. Mercado Pago Webhook (2 min)

1. https://www.mercadopago.com.br/developers
2. Suas integrações → Webhooks
3. Adicionar webhook:
   - URL: `https://linax-production-xxxx.up.railway.app/api/payments/webhook`
   - Events: payment.*, subscription.*
4. Copy secret → Railway: `MERCADO_PAGO_WEBHOOK_SECRET`

---

## ✅ Done!

Your system is now live at:
```
https://linax-production-xxxx.up.railway.app
```

---

## Quick Reference

| Task | URL |
|------|-----|
| App | `https://linax-production-xxxx.up.railway.app` |
| Health Check | `https://linax-production-xxxx.up.railway.app/health` |
| Admin | `https://linax-production-xxxx.up.railway.app/admin/dashboard.html` |
| SendGrid | https://sendgrid.com |
| Mercado Pago | https://www.mercadopago.com.br/developers |
| Railway | https://railway.app |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Build fails | Check logs. Verify package.json. Try manually: `npm install && npm run build` |
| DB not connecting | Verify PostgreSQL service exists. Check DATABASE_URL. Restart service. |
| Emails not sending | Verify SENDGRID_API_KEY. Verify sender verified in SendGrid. Check quota. |
| API returning 401 | Check JWT_SECRET set. Verify token in localStorage. |
| Payment webhook not working | Check webhook URL is HTTPS. Verify domain accessible. Check secret. |
| Can't login | Check email/password correct. Check database has user. Check logs for errors. |

---

**Full Guide:** DEPLOY-RAILWAY.md
**Testing Guide:** DEPLOY-TESTING.md
**Env Setup:** RAILWAY-ENV-SETUP.md

For issues: Check Railway logs first, then documentation.

---

**Status:** 🟢 Ready to Deploy
**Time Saved:** ~2 hours vs manual setup
**Cost:** $0 first month, $5-10/month after (if needed)

Deploy now! 🚀
