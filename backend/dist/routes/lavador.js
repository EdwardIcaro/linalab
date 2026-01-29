"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const lavadorController_1 = require("../controllers/lavadorController");
const router = (0, express_1.Router)();
router.get('/', lavadorController_1.getLavadores);
router.get('/simple', lavadorController_1.getLavadoresSimple); // <-- Rota que estava faltando
router.get('/tokens', lavadorController_1.getLavadorTokens);
router.put('/tokens/:id/status', lavadorController_1.updateLavadorTokenStatus);
router.patch('/tokens/:id/toggle', lavadorController_1.toggleLavadorToken);
router.delete('/tokens/:id', lavadorController_1.deleteLavadorToken);
router.post('/', lavadorController_1.createLavador);
router.put('/:id', lavadorController_1.updateLavador);
router.delete('/:id', lavadorController_1.deleteLavador);
router.post('/:id/token', lavadorController_1.gerarTokenPublico); // MUDADO PARA POST
exports.default = router;
//# sourceMappingURL=lavador.js.map