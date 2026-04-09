import { registerIntegrationSuiteHooks } from "./helpers/setup";

registerIntegrationSuiteHooks();

import "./auth.session.test";
import "./bookings.test";
import "./chats.test";
