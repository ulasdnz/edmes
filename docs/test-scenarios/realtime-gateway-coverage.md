# Coverage Map — realtime-gateway
Generated: 2026-03-28

| Scenario | Test location | Status |
|----------|--------------|--------|
| EventConsumer.catchAllFallback / happy / specific handler called with (data, type) | consumer.test.ts:114 | ✅ |
| EventConsumer.catchAllFallback / happy / '*' handler called when no specific | consumer.test.ts:23 | ✅ |
| EventConsumer.catchAllFallback / happy / type string matches parsed.type | consumer.test.ts:51 | ✅ |
| EventConsumer.catchAllFallback / constraints / specific takes priority over '*' | consumer.test.ts:83 | ✅ |
| EventConsumer.catchAllFallback / constraints / no handler -> event skipped | consumer.test.ts:146 | ✅ |
| EventConsumer.catchAllFallback / edge / both 'foo.bar' specific and '*' -> only specific | consumer.test.ts:83 | ✅ |
| EventConsumer.catchAllFallback / edge / '*' only for types without specific handler | consumer.test.ts:173 | ✅ |
| resolveRooms / happy / job_order.started with workCenterId | router.test.ts:5 | ✅ |
| resolveRooms / happy / role.updated empty payload | router.test.ts:10 | ✅ |
| resolveRooms / happy / production_plan.created empty payload | router.test.ts:15 | ✅ |
| resolveRooms / happy / scrap_entry.created jobOrderId NOT a routing key | router.test.ts:20 | ✅ |
| resolveRooms / constraints / entity prefix from type.split('.')[0] | router.test.ts:29 | ✅ |
| resolveRooms / constraints / workCenterId adds wc:{id} | router.test.ts:34 | ✅ |
| resolveRooms / constraints / previousWorkCenterId adds wc:{previousId} | router.test.ts:39 | ✅ |
| resolveRooms / constraints / jobOrderId NOT a room | router.test.ts:47 | ✅ |
| resolveRooms / boundaries / type with no dot | router.test.ts:55 | ✅ |
| resolveRooms / boundaries / type with multiple dots -> first segment | router.test.ts:60 | ✅ |
| resolveRooms / edge / both workCenterId and previousWorkCenterId differ -> three rooms | router.test.ts:67 | ✅ |
| resolveRooms / edge / same workCenterId and previousWorkCenterId -> duplicate wc rooms | router.test.ts:75 | ✅ |
| resolveRooms / edge / empty payload -> only entity prefix | router.test.ts:83 | ✅ |
| resolveRooms / edge / workCenterId falsy -> NOT added | router.test.ts:88 | ✅ |
| resolveRooms / edge / previousWorkCenterId falsy -> NOT added | router.test.ts:95 | ✅ |
| SocketServer.joinHandler / happy / joins multiple rooms | socket.test.ts:48 | ✅ |
| SocketServer.joinHandler / happy / joins single room | socket.test.ts:58 | ✅ |
| SocketServer.joinHandler / constraints / replaces all current room subscriptions | socket.test.ts:67 | ✅ |
| SocketServer.joinHandler / constraints / default socket.id room never left | socket.test.ts:79 | ✅ |
| SocketServer.joinHandler / constraints / not array -> no-op | socket.test.ts:88 | ✅ |
| SocketServer.joinHandler / boundaries / empty array -> all non-default left, none joined | socket.test.ts:98 | ✅ |
| SocketServer.joinHandler / boundaries / single room -> joins exactly one | socket.test.ts:109 | ✅ |
| SocketServer.joinHandler / edge / second join replaces first | socket.test.ts:119 | ✅ |
| SocketServer.joinHandler / edge / missing rooms field -> no-op | socket.test.ts:135 | ✅ |
| SocketServer.joinHandler / edge / rooms is string -> no-op | socket.test.ts:145 | ✅ |
| SocketServer.joinHandler / edge / rooms is null -> no-op | socket.test.ts:155 | ✅ |
| SocketServer.configuration / constraints / transports websocket only | socket.test.ts:38 | ✅ |
| SocketServer.configuration / constraints / CORS origin '*' | socket.test.ts:43 | ✅ |
| Subscribers.catchAllForwarding / happy / resolveRooms called, emitted to rooms | subscribers.test.ts:56 | ✅ |
| Subscribers.catchAllForwarding / happy / io.to(rooms).emit(type, payload) | subscribers.test.ts:66 | ✅ |
| Subscribers.catchAllForwarding / constraints / consumer group is 'realtime' | subscribers.test.ts:76 | ✅ |
| Subscribers.catchAllForwarding / constraints / three streams subscribed | subscribers.test.ts:80 | ✅ |
| Subscribers.catchAllForwarding / constraints / '*' handler for all streams | subscribers.test.ts:87 | ✅ |
| Subscribers.catchAllForwarding / edge / no connected clients -> no error | subscribers.test.ts:96 | ✅ |
| ScrapEntryEmit.create / happy / calls emitScrapEntryCreated with correct args | scrap-entry.service.test.ts:313 | ✅ |
| ScrapEntryEmit.create / constraints / all three params as strings | scrap-entry.service.test.ts:323 | ✅ |
| ScrapEntryEmit.update / happy / calls emitScrapEntryUpdated with pre-update fields | scrap-entry.service.test.ts:334 | ✅ |
| ScrapEntryEmit.update / constraints / uses pre-update doc, not post-update | scrap-entry.service.test.ts:347 | ✅ |
| ScrapEntryEmit.remove / happy / calls emitScrapEntryDeleted from fetched doc | scrap-entry.service.test.ts:359 | ✅ |
| ScrapEntryEmit.remove / constraints / routing fields from doc before deletion | scrap-entry.service.test.ts:372 | ✅ |
| QuantityAdjustmentEmit.create / happy / calls emitQuantityAdjustmentCreated | qa.service.test.ts:255 | ✅ |
| QuantityAdjustmentEmit.create / constraints / all three params as strings | qa.service.test.ts:265 | ✅ |
| QuantityAdjustmentEmit.update / happy / calls emitQuantityAdjustmentUpdated | qa.service.test.ts:276 | ✅ |
| QuantityAdjustmentEmit.update / constraints / uses pre-update doc | qa.service.test.ts:289 | ✅ |
| QuantityAdjustmentEmit.remove / happy / calls emitQuantityAdjustmentDeleted | qa.service.test.ts:301 | ✅ |
| QuantityAdjustmentEmit.remove / constraints / routing fields from doc before deletion | qa.service.test.ts:314 | ✅ |
| JobOrderEmit.update / happy / previousWorkCenterId when workCenterId changes | job-order.service.test.ts:722 | ✅ |
| JobOrderEmit.update / happy / undefined previousWorkCenterId when omitting workCenterId | job-order.service.test.ts:745 | ✅ |
| JobOrderEmit.update / constraints / only set when truthy AND differs | job-order.service.test.ts:755 | ✅ |
| JobOrderEmit.update / constraints / string-based comparison | job-order.service.test.ts:774 | ✅ |
| JobOrderEmit.update / constraints / current workCenterId in emit even without PATCH | job-order.service.test.ts:783 | ✅ |
| JobOrderEmit.update / boundaries / same value -> undefined previousWorkCenterId | job-order.service.test.ts:792 | ✅ |
| JobOrderEmit.update / boundaries / undefined workCenterId -> undefined previous | job-order.service.test.ts:805 | ✅ |
| JobOrderEmit.update / boundaries / new ObjectId -> old as previousWorkCenterId | job-order.service.test.ts:813 | ✅ |
| RealtimeConfig.validation / happy / valid env parsed correctly | config.test.ts:15 | ✅ |
| RealtimeConfig.validation / constraints / invalid REDIS_URL -> exit(1) | config.test.ts:28 | ✅ |
| RealtimeConfig.validation / constraints / empty REDIS_URL -> exit(1) | config.test.ts:37 | ✅ |
| RealtimeConfig.validation / constraints / PORT defaults 3003 | config.test.ts:46 | ✅ |
| RealtimeConfig.validation / constraints / NODE_ENV defaults 'development' | config.test.ts:54 | ✅ |
| RealtimeConfig.validation / constraints / LOG_LEVEL defaults 'info' | config.test.ts:62 | ✅ |
| RealtimeConfig.validation / boundaries / rediss:// TLS valid | config.test.ts:70 | ✅ |
| RealtimeConfig.validation / boundaries / http:// protocol invalid | config.test.ts:80 | ✅ |
| RealtimeConfig.validation / boundaries / redis:// no host invalid | config.test.ts:89 | ✅ |

## Summary
- Total scenarios: 70
- Covered: 70
- Missing (CRITICAL): 0
- Missing: 0
- Bugs found: 0
- Spec mismatches: 0
