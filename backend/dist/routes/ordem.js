"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = __importDefault(require("../middlewares/authMiddleware"));
const ordemController_1 = require("../controllers/ordemController");
const router = (0, express_1.Router)();
// Rotas de ordens de serviço (todas requerem middleware de multi-empresa)
router.post('/', authMiddleware_1.default, ordemController_1.createOrdem);
router.get('/', authMiddleware_1.default, ordemController_1.getOrdens);
router.get('/stats', authMiddleware_1.default, ordemController_1.getOrdensStats);
router.get('/:id', authMiddleware_1.default, ordemController_1.getOrdemById);
router.put('/:id', authMiddleware_1.default, ordemController_1.updateOrdem);
router.post('/:id/finalizar', authMiddleware_1.default, ordemController_1.finalizarOrdem);
router.patch('/:id/cancel', authMiddleware_1.default, ordemController_1.cancelOrdem);
router.delete('/:id', authMiddleware_1.default, ordemController_1.deleteOrdem);
exports.default = router;
//# sourceMappingURL=ordem.js.map