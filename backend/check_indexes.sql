-- Verificar se os índices existem
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('ordens_servico', 'clientes', 'veiculos', 'pagamentos')
ORDER BY tablename, indexname;
