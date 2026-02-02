# 🧪 Testing Guide - LinaX Post-Deployment Validation

Complete testing checklist for validating LinaX deployment on Railway.

---

## ✅ Pre-Testing Setup

Before running tests, ensure:
- [ ] Deploy completed successfully on Railway
- [ ] All environment variables configured
- [ ] PostgreSQL database is running
- [ ] Health check responding
- [ ] SendGrid account verified and ready
- [ ] Mercado Pago sandbox credentials configured

---

## Phase 1: Infrastructure Tests (5 minutes)

### Test 1.1: Health Check Endpoint

**Purpose:** Verify API is running and responding

```bash
curl https://SEU_DOMINIO_RAILWAY.up.railway.app/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "timestamp": "2026-02-02T10:30:45.123Z",
  "version": "1.0.0"
}
```

**What to check:**
- [ ] Status code is 200
- [ ] Response has correct JSON format
- [ ] Timestamp is current (within 1 minute)

**If fails:**
- Check Railway logs
- Verify PORT environment variable
- Verify all dependencies installed

### Test 1.2: Database Connection

**Purpose:** Verify PostgreSQL is connected

**Via API - Create a test user and check database:**
1. Call signup endpoint (see Test 2.1)
2. Railway Logs should show no connection errors
3. Check logs for: `prisma` or `database` errors

**Expected:** No database connection errors in logs

**If fails:**
- Verify DATABASE_URL is set in Railway
- Check PostgreSQL service is running
- Verify credentials are correct

### Test 1.3: Frontend Static Files

**Purpose:** Verify frontend is being served

Open in browser:
```
https://SEU_DOMINIO_RAILWAY.up.railway.app/login.html
```

**Expected:**
- [ ] Page loads (may not have styles yet)
- [ ] HTML elements visible
- [ ] No 404 errors

**If fails:**
- Check if DESKTOPV2 folder exists in repo
- Verify frontend path in index.ts
- Check file permissions

---

## Phase 2: Authentication Tests (10 minutes)

### Test 2.1: User Registration (Signup)

**Purpose:** Verify user creation and email sending

**Steps:**
1. Open: `https://SEU_DOMINIO_RAILWAY.up.railway.app/signup.html`
2. Fill form:
   - Email: `test.user.1@example.com`
   - Password: `TestPassword123!`
   - Confirm Password: `TestPassword123!`
   - Full Name: `Test User`
3. Click "Create Account"
4. **Expected:** Redirected to login page

**What to verify:**
- [ ] Page redirects after signup
- [ ] No error messages
- [ ] Can proceed to login

**Email Verification:**
1. Check your email inbox (the one registered)
2. **Expected:** Welcome email from LinaX
3. If not received:
   - Check spam folder
   - Wait 30 seconds
   - Check SendGrid logs in Railway

**If registration fails:**
- Check API endpoint: `POST /api/usuarios/register`
- Check logs for validation errors
- Verify all required fields filled
- Check DATABASE_URL

**If email not sent:**
- Verify SENDGRID_API_KEY is set
- Verify EMAIL_FROM is set
- Check SendGrid sender verification
- Check SendGrid quota (100/day free)

### Test 2.2: User Login

**Purpose:** Verify authentication works

**Steps:**
1. Open: `https://SEU_DOMINIO_RAILWAY.up.railway.app/login.html`
2. Fill form:
   - Email: `test.user.1@example.com`
   - Password: `TestPassword123!`
3. Click "Sign In"
4. **Expected:** Redirected to company selection page

**What to verify:**
- [ ] Login succeeds with correct credentials
- [ ] JWT token created (check localStorage)
- [ ] Redirects to next page

**If login fails:**
- Verify email is correct (case-sensitive)
- Check password matches registration
- Check API logs for auth errors
- Verify JWT_SECRET is set

### Test 2.3: JWT Token Validation

**Purpose:** Verify tokens are created correctly

**Browser Console:**
```javascript
localStorage.getItem('token')
```

**Expected:** Long string starting with "eyJ" (JWT format)

**Decode token (via https://jwt.io):**
1. Copy token from localStorage
2. Visit: https://jwt.io
3. Paste token in "Encoded" field
4. **Expected payload should include:**
   ```json
   {
     "id": "user_id",
     "email": "test.user.1@example.com",
     "iat": timestamp,
     "exp": timestamp
   }
   ```

**If token invalid:**
- Verify JWT_SECRET matches between runs
- Check BCRYPT_SALT_ROUNDS setting
- Verify token not expired

---

## Phase 3: Multi-Tenancy Tests (10 minutes)

### Test 3.1: Create Company

**Purpose:** Verify multi-company support

**Steps:**
1. After login, you should see "Select or Create Company"
2. Click "Create New Company"
3. Fill form:
   - Company Name: `Test Car Wash`
   - CNPJ: `00.000.000/0000-00`
   - Address: `Rua Teste, 123`
   - City: `São Paulo`
   - State: `SP`
4. Click "Create"
5. **Expected:** Dashboard loads with company context

**What to verify:**
- [ ] Company created successfully
- [ ] Dashboard displays company name
- [ ] Can see company selector (top right)
- [ ] Token updated with empresa context

**If fails:**
- Check API: `POST /api/empresas`
- Verify user authenticated
- Check company validation rules
- Check database for empresa table

### Test 3.2: Company Selector

**Purpose:** Verify can switch between companies

**Steps:**
1. Create a second company (repeat Test 3.1)
2. Click company selector (usually top-right)
3. See list of all companies
4. Click different company
5. **Expected:** Dashboard updates for selected company

**What to verify:**
- [ ] Both companies listed
- [ ] Switching works without logout
- [ ] Data is company-scoped
- [ ] No data leakage between companies

**If fails:**
- Check middleware `multiEmpresa`
- Verify token includes `empresaId`
- Check API filters by empresa

---

## Phase 4: Subscription Tests (15 minutes)

### Test 4.1: Free Plan Activation

**Purpose:** Verify free trial is granted

**Steps:**
1. After creating company, go to: "Plans" or "Assinatura"
2. **Expected:** See "Free Plan" marked as "Active"
3. Should show:
   - Plan name: "Gratuito"
   - Status: "Ativo"
   - Trial days remaining: 7 (or configured value)
   - Valid until: (current date + 7 days)

**What to verify:**
- [ ] Free plan automatically activated
- [ ] Trial days shown correctly
- [ ] No upgrade button for free plan
- [ ] Can access all free features

**If free plan not active:**
- Check subscription middleware
- Verify trial_days in SubscriptionPlan
- Check database: Subscription table
- Check logs for subscription creation error

### Test 4.2: View Available Plans

**Purpose:** Verify subscription plans are displayed

**Steps:**
1. Go to: "Plans" or "Assinatura"
2. Scroll down to see all plans
3. **Expected:** See multiple plans:
   - Gratuito (Free) - with trial
   - Professional
   - Premium
   - Enterprise

**What to verify:**
- [ ] All plans displayed
- [ ] Prices shown correctly
- [ ] Feature lists visible
- [ ] Can see trial period info

**If plans not showing:**
- Check API: `GET /api/subscriptions/plans`
- Verify SubscriptionPlan table has data
- Check database seed data
- Verify plans marked as `ativo: true`

### Test 4.3: View Current Subscription

**Purpose:** Verify can see active subscription details

**Steps:**
1. Go to: "Minha Assinatura" or Profile → Subscription
2. **Expected:** See details of current free plan:
   - Plan name
   - Status (Ativo)
   - Start date
   - Expiration date
   - Features included
   - Upgrade button

**What to verify:**
- [ ] Correct plan displayed
- [ ] Dates are accurate
- [ ] Features list shows
- [ ] Upgrade button visible

**If fails:**
- Check API: `GET /api/subscriptions/me`
- Verify user has subscription record
- Check database: Subscription table
- Verify subscription dates

---

## Phase 5: Core Business Logic Tests (15 minutes)

### Test 5.1: Create Customer

**Purpose:** Verify CRM functionality

**Steps:**
1. Go to: "Clientes" (Customers)
2. Click: "+ Novo Cliente" (New Customer)
3. Fill form:
   - Name: `João Silva`
   - Email: `joao@email.com`
   - Phone: `(11) 99999-9999`
   - CPF/CNPJ: `123.456.789-00`
   - Address: `Rua Exemplo, 100`
4. Click: "Salvar" (Save)
5. **Expected:** Customer appears in list

**What to verify:**
- [ ] Customer created successfully
- [ ] Appears in customer list
- [ ] Can click to view details
- [ ] Edit functionality works
- [ ] Scoped to current company

**If fails:**
- Check API: `POST /api/clientes`
- Verify authentication middleware
- Check empresaId is set in request
- Verify database: cliente table

### Test 5.2: Create Service

**Purpose:** Verify service catalog

**Steps:**
1. Go to: "Serviços" (Services) or Admin settings
2. Click: "+ Novo Serviço"
3. Fill form:
   - Service Name: `Lavagem Simples`
   - Description: `Lavagem externa básica`
   - Price: `50.00`
   - Duration: `30` minutes
4. Click: "Salvar"
5. **Expected:** Service added to list

**What to verify:**
- [ ] Service created and listed
- [ ] Price shows correctly
- [ ] Can edit service
- [ ] Can delete service
- [ ] Scoped to current company

**If fails:**
- Check API: `POST /api/servicos`
- Verify service validation
- Check database: servico table

### Test 5.3: Create Order

**Purpose:** Verify order management

**Steps:**
1. Go to: "Ordens" (Orders)
2. Click: "+ Nova Ordem"
3. Fill form:
   - Select Customer: `João Silva`
   - Select Vehicle: (if exists, or create)
   - Select Services: `Lavagem Simples`
   - Notes: `Carro limpo por fora`
4. Click: "Criar Ordem"
5. **Expected:** Order created with status "Pendente"

**What to verify:**
- [ ] Order appears in list
- [ ] Status shows as "Pendente"
- [ ] Can click to view details
- [ ] Can edit order
- [ ] Shows correct services and pricing
- [ ] Total price calculated correctly

**If fails:**
- Check API: `POST /api/ordens`
- Verify customer exists
- Check service pricing
- Verify database: ordem_servico table

### Test 5.4: Complete Order

**Purpose:** Verify order finalization

**Steps:**
1. In order details, click: "Finalizar" (Finalize)
2. Confirm action
3. **Expected:** Order status changes to "Concluída"

**What to verify:**
- [ ] Status updates immediately
- [ ] Can't edit after finalization
- [ ] Payment record created (if paid)
- [ ] Employee commission calculated (if applicable)

**If fails:**
- Check API: `PUT /api/ordens/:id`
- Check order status validation
- Verify database update works

---

## Phase 6: Payment Tests (20 minutes)

### Test 6.1: Mercado Pago Sandbox Payment

**Purpose:** Verify payment integration without real money

**Prerequisites:**
- Have Mercado Pago TEST- credentials configured
- Have a pending order with payment

**Steps:**
1. Go to: "Financeiro" (Financial) or Order details
2. Look for order with payment pending
3. Click: "Pagar" (Pay) or similar button
4. **Expected:** Redirected to Mercado Pago sandbox
5. Fill sandbox test card:
   - Card Number: `4111 1111 1111 1111`
   - Expiration: `12/25`
   - CVV: `123`
   - Cardholder: `Test User`
6. Click: "Pagar"
7. **Expected:** Redirected back to success page

**What to verify:**
- [ ] Redirects to payment gateway
- [ ] Can fill test card
- [ ] Returns to success URL
- [ ] Order status updated to "Pago"
- [ ] Payment record created

**If fails:**
- Check MERCADO_PAGO_PUBLIC_KEY
- Verify payment button works
- Check browser console for errors
- Verify PAYMENT_SUCCESS_URL is HTTPS

### Test 6.2: Check Payment Webhook

**Purpose:** Verify payment updates are processed

**Steps:**
1. After payment completes, check:
   - Order status in system (should be "Pago")
   - Payment table in database
   - Email notification received
2. Check Railway logs:
   - Look for `/api/payments/webhook` calls
   - Should show payment status: "approved"

**What to verify:**
- [ ] Order status updated
- [ ] Payment record created
- [ ] Webhook was called
- [ ] Email notification sent (if enabled)

**If webhook not called:**
- Verify webhook URL in Mercado Pago
- Check URL is HTTPS (required)
- Check MERCADO_PAGO_WEBHOOK_SECRET
- Verify domain is accessible from Mercado Pago

### Test 6.3: Payment Notifications

**Purpose:** Verify email notifications for payments

**Steps:**
1. Complete a payment
2. Check email inbox
3. **Expected:** Receive payment confirmation email

**What to verify:**
- [ ] Email arrives within 1 minute
- [ ] Contains correct payment info
- [ ] Has correct order number
- [ ] Sent from EMAIL_FROM address

**If email not received:**
- Check spam folder
- Wait 1 minute
- Check SendGrid quota (100/day)
- Check SENDGRID_API_KEY

---

## Phase 7: Background Jobs Tests (15 minutes)

### Test 7.1: Cron Job - Order Finalization

**Purpose:** Verify automatic order finalization every 15 minutes

**Steps:**
1. Check Railway logs: Railway Dashboard → Logs
2. Look for messages like:
   ```
   [CRON] Verificando ordens para finalização automática...
   [CRON] Ordens finalizadas: X
   ```
3. These should appear every 15 minutes

**What to verify:**
- [ ] Log message appears regularly (every 15 min)
- [ ] No errors in logs
- [ ] Pending orders are auto-finalized
- [ ] Status updates correctly

**If not running:**
- Check index.ts for cron configuration
- Verify node-cron installed
- Check logs for schedule errors

### Test 7.2: Cron Job - Subscription Expiration

**Purpose:** Verify subscription checks every 6 hours

**Steps:**
1. Check Railway logs for:
   ```
   [CRON] Verificando assinaturas expiradas...
   ```
2. Should appear every 6 hours (usually 00:00, 06:00, 12:00, 18:00)

**What to verify:**
- [ ] Message appears in logs
- [ ] Handles expired subscriptions
- [ ] Sends notifications if enabled

**If not working:**
- Check subscription expiration logic
- Verify database queries
- Check email notifications

### Test 7.3: Cron Job - Trial Expiration

**Purpose:** Verify trial warnings sent daily

**Steps:**
1. Check logs for:
   ```
   [CRON] Verificando avisos de trial...
   ```
2. Should appear daily around 09:00

**What to verify:**
- [ ] Message appears in logs
- [ ] Sends emails for expiring trials (7 days left)
- [ ] Subscription updated correctly

**If not working:**
- Check trial expiration dates
- Verify email sending
- Check schedule time

---

## Phase 8: Performance Tests (10 minutes)

### Test 8.1: Response Time

**Purpose:** Verify acceptable API performance

**Browser DevTools Network Tab:**
1. Open: https://SEU_DOMINIO_RAILWAY.app/login.html
2. Open DevTools (F12) → Network tab
3. Perform actions:
   - Login
   - Create order
   - View reports
4. Check response times for each request

**Expected Response Times:**
- **API endpoints:** < 500ms
- **Page loads:** < 2000ms (first load)
- **Database queries:** < 200ms

**If slow:**
- Check Railway CPU/Memory metrics
- Optimize database queries
- Consider database indexes
- Check for N+1 queries in code

### Test 8.2: Memory Usage

**Purpose:** Verify no memory leaks

**Railway Dashboard → Metrics:**
1. Go to: Service → Metrics
2. Check "Memory" graph
3. Should stay constant (100-200 MB)
4. Should not continuously increase

**Expected:** Memory stable over time

**If increasing:**
- Possible memory leak
- Check logs for error patterns
- Restart service if needed

### Test 8.3: CPU Usage

**Purpose:** Verify efficient resource usage

**Railway Dashboard → Metrics:**
1. Go to: Service → Metrics
2. Check "CPU" graph
3. Should be low at rest (< 5%)
4. Should peak during requests (< 80%)

**Expected:** CPU returns to normal after requests

**If always high:**
- Check for infinite loops
- Check for heavy computations
- Profile application code

---

## Phase 9: Data Integrity Tests (10 minutes)

### Test 9.1: Multi-Company Data Isolation

**Purpose:** Verify no data leakage between companies

**Steps:**
1. Create User 1 with Company A
   - Create customer "Customer A" in Company A
2. Create User 2 with Company B
   - Create customer "Customer B" in Company B
3. Login as User 1 (Company A)
4. Check customer list
   - **Expected:** Only "Customer A" visible
   - **NOT visible:** "Customer B"
5. Login as User 2 (Company B)
6. Check customer list
   - **Expected:** Only "Customer B" visible
   - **NOT visible:** "Customer A"

**What to verify:**
- [ ] Users cannot see other company data
- [ ] Orders scoped to company
- [ ] Employees scoped to company
- [ ] Financial reports scoped to company

**If data leaks:**
- Check middleware `authMiddleware`
- Verify `empresaId` filtering in all queries
- Check Prisma where clauses

### Test 9.2: Database Backup

**Purpose:** Verify backups are working

**Railway Dashboard → PostgreSQL Service:**
1. Go to: PostgreSQL → Backups
2. **Expected:** See automated backups
3. Should show daily snapshots

**What to verify:**
- [ ] Backups exist
- [ ] Backups are recent (< 24h old)
- [ ] Can view backup details

**If no backups:**
- Check PostgreSQL settings
- Backups may be automatic
- Manual backup command:
  ```bash
  railway run pg_dump DATABASE_URL > backup.sql
  ```

---

## Phase 10: Security Tests (15 minutes)

### Test 10.1: HTTPS Enforcement

**Purpose:** Verify all traffic is encrypted

**Steps:**
1. Try to access: `http://SEU_DOMINIO_RAILWAY.app` (without https)
2. **Expected:** Redirects to `https://...`
3. Check SSL certificate:
   - Click lock icon in address bar
   - Should show "Secure" and certificate details
   - Issued by: Let's Encrypt or similar

**What to verify:**
- [ ] HTTP redirects to HTTPS
- [ ] Certificate is valid
- [ ] No warnings about cert

**If not HTTPS:**
- Railway usually handles this automatically
- Check settings for SSL enforcement
- Verify custom domain configured correctly

### Test 10.2: CORS Protection

**Purpose:** Verify cross-origin requests are controlled

**Browser Console:**
```javascript
fetch('https://SEU_DOMINIO_RAILWAY.app/api/usuarios/register', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({email: 'test@test.com'})
}).then(r => r.json()).then(console.log)
```

**Expected:** Request succeeds (CORS allows same-origin)

**If CORS blocked:**
- Check CORS configuration in index.ts
- Verify FRONTEND_URL matches request origin
- Check allowed methods and headers

### Test 10.3: SQL Injection Prevention

**Purpose:** Verify Prisma ORM protection

**Steps:**
1. Try creating customer with SQL injection payload:
   - Name: `"; DROP TABLE clientes; --`
2. **Expected:**
   - No error
   - String is escaped
   - No table dropped

**What to verify:**
- [ ] Payload treated as string
- [ ] No SQL executed
- [ ] No database damage

**Why it's safe:**
- Using Prisma ORM (parameterized queries)
- Input validation on frontend/backend
- Database permissions limited

### Test 10.4: XSS Prevention

**Purpose:** Verify JavaScript injection prevention

**Steps:**
1. Create customer with XSS payload:
   - Name: `<img src=x onerror=alert('XSS')>`
2. View customer details
3. **Expected:**
   - No alert popup
   - HTML is escaped
   - Shows literal text

**What to verify:**
- [ ] JavaScript doesn't execute
- [ ] HTML is escaped
- [ ] Safe display of user input

### Test 10.5: Authentication Required

**Purpose:** Verify protected endpoints require token

**Steps:**
1. Try accessing protected endpoint without token:
   ```bash
   curl https://SEU_DOMINIO_RAILWAY.app/api/clientes
   ```
2. **Expected:**
   - Status code: 401 Unauthorized
   - Cannot access data without token

**What to verify:**
- [ ] Returns 401 without token
- [ ] Protected endpoints verified
- [ ] Only public endpoints accessible

---

## Phase 11: Monitoring & Logging (5 minutes)

### Test 11.1: Check Application Logs

**Railway Dashboard → Logs:**
1. Check for patterns:
   - No continuous error streams
   - No 500 errors
   - Expected startup messages

**Expected logs on startup:**
```
🚀 Servidor Lina X rodando na porta 3001
📊 Health check: http://localhost:3001/health
🕒 Agendador de finalização de ordens ativado para rodar a cada 15 minutos.
[CRON] Verificando ordens...
```

**What to verify:**
- [ ] No error messages
- [ ] Cron jobs running
- [ ] Database connected
- [ ] No warnings

### Test 11.2: Check Metrics

**Railway Dashboard → Metrics:**
1. Observe graphs:
   - CPU: Spikes during activity, low at rest
   - Memory: Stable (100-300 MB)
   - Network: Proportional to traffic
2. Should look healthy

**What to verify:**
- [ ] No resource spikes
- [ ] Memory not increasing
- [ ] CPU manageable

### Test 11.3: Configure Uptime Monitoring

**Optional but recommended:**
1. Sign up at: https://uptimerobot.com
2. Create monitor for:
   - URL: `https://SEU_DOMINIO_RAILWAY.app/health`
   - Check interval: 5 minutes
3. Receive alerts if down

**What to verify:**
- [ ] Monitor created
- [ ] Getting successful checks
- [ ] Email alerts work

---

## Test Summary Checklist

### Infrastructure (9 tests)
- [ ] Health check responding
- [ ] Database connected
- [ ] Frontend loading
- [ ] Logs clean
- [ ] CPU normal
- [ ] Memory stable
- [ ] Network working
- [ ] HTTPS active
- [ ] Backups exist

### Authentication (5 tests)
- [ ] Signup works
- [ ] Confirmation email sent
- [ ] Login works
- [ ] JWT token created
- [ ] Token has correct claims

### Multi-Tenancy (2 tests)
- [ ] Create company works
- [ ] Company selector works
- [ ] Data isolation verified

### Subscriptions (3 tests)
- [ ] Free plan activated
- [ ] Plans displayed
- [ ] Current subscription shown

### Business Logic (4 tests)
- [ ] Customer creation
- [ ] Service creation
- [ ] Order creation
- [ ] Order finalization

### Payments (3 tests)
- [ ] Sandbox payment works
- [ ] Webhook processing
- [ ] Email notifications

### Background Jobs (3 tests)
- [ ] Order finalization cron
- [ ] Subscription expiration cron
- [ ] Trial warning cron

### Performance (3 tests)
- [ ] Response time < 500ms
- [ ] Memory usage stable
- [ ] CPU usage reasonable

### Data Integrity (2 tests)
- [ ] Multi-company isolation
- [ ] Database backup exists

### Security (5 tests)
- [ ] HTTPS enforced
- [ ] CORS working
- [ ] SQL injection prevented
- [ ] XSS prevented
- [ ] Auth required on protected endpoints

### Monitoring (3 tests)
- [ ] Logs clean
- [ ] Metrics healthy
- [ ] Uptime monitor active

**Total Tests:** 42
**Status:** Ready for user testing when all pass ✅

---

## Test Report Template

```markdown
## LinaX Deployment Test Report

**Date:** [DATE]
**Environment:** Railway Production
**Tester:** [YOUR NAME]

### Infrastructure Tests
- [ ] Health check: PASS/FAIL
- [ ] Database connection: PASS/FAIL
- [ ] Frontend loading: PASS/FAIL

### Authentication Tests
- [ ] Signup: PASS/FAIL
- [ ] Email: PASS/FAIL
- [ ] Login: PASS/FAIL
- [ ] JWT: PASS/FAIL

### Business Logic Tests
- [ ] Customer creation: PASS/FAIL
- [ ] Service creation: PASS/FAIL
- [ ] Order creation: PASS/FAIL
- [ ] Order finalization: PASS/FAIL

### Payment Tests
- [ ] Sandbox payment: PASS/FAIL
- [ ] Webhook processing: PASS/FAIL
- [ ] Email notification: PASS/FAIL

### Background Jobs
- [ ] Cron jobs running: PASS/FAIL

### Performance
- [ ] Response time acceptable: PASS/FAIL
- [ ] Memory stable: PASS/FAIL

### Security
- [ ] HTTPS enforced: PASS/FAIL
- [ ] Auth required: PASS/FAIL
- [ ] Data isolated: PASS/FAIL

### Summary
- **Total Passed:** X / 42
- **Overall Status:** READY / NOT READY
- **Issues Found:** [List any]
- **Blockers:** [Any critical issues]

### Sign-off
- Approved for user testing: [ ] YES [ ] NO
- Next steps: [Deploy schedule, user beta, etc]
```

---

**Ready to test!** 🚀

Run through each phase in order. Stop at any FAIL and troubleshoot before continuing.
