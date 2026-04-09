import { registerIntegrationSuiteHooks } from "./helpers/setup";

registerIntegrationSuiteHooks();

import "./auth.session.test";
import "./bookings.test";
import "./chats.test";
import "./discover.test";
import "./realtime-stream.test";
import "./schema-contract.test";
import "./users.test";
