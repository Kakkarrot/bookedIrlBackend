-- Core tables for marketplace
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  display_name text,
  username text,
  email text UNIQUE,
  headline text,
  bio text,
  birthday date,
  onboarding_step text NOT NULL DEFAULT 'BIRTHDAY',
  intent_looking boolean NOT NULL DEFAULT false,
  intent_offering boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username)) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_locations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  location geography(Point, 4326) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  price_dollars int NOT NULL,
  duration_minutes int NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_photos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_social_links (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  buyer_id uuid NOT NULL REFERENCES users(id),
  seller_id uuid NOT NULL REFERENCES users(id),
  participant_a uuid NOT NULL REFERENCES users(id),
  participant_b uuid NOT NULL REFERENCES users(id),
  service_id uuid NOT NULL REFERENCES services(id),
  service_title text NOT NULL,
  service_price_dollars int NOT NULL,
  service_duration_minutes int NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'accepted', 'declined')),
  requested_date date NOT NULL,
  time_of_day text NOT NULL CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'night')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY,
  buyer_id uuid NOT NULL REFERENCES users(id),
  seller_id uuid NOT NULL REFERENCES users(id),
  participant_a uuid REFERENCES users(id),
  participant_b uuid REFERENCES users(id),
  service_id uuid REFERENCES services(id),
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_reads (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS services_user_id_idx ON services(user_id);
CREATE INDEX IF NOT EXISTS user_photos_user_id_idx ON user_photos(user_id);
CREATE INDEX IF NOT EXISTS user_social_links_user_id_idx ON user_social_links(user_id);
CREATE INDEX IF NOT EXISTS bookings_buyer_id_idx ON bookings(buyer_id);
CREATE INDEX IF NOT EXISTS bookings_seller_id_idx ON bookings(seller_id);
CREATE INDEX IF NOT EXISTS bookings_participant_a_idx ON bookings(participant_a);
CREATE INDEX IF NOT EXISTS bookings_participant_b_idx ON bookings(participant_b);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_open_pair_idx ON bookings(participant_a, participant_b) WHERE status IN ('requested', 'accepted');
CREATE INDEX IF NOT EXISTS chats_buyer_id_idx ON chats(buyer_id);
CREATE INDEX IF NOT EXISTS chats_seller_id_idx ON chats(seller_id);
CREATE INDEX IF NOT EXISTS chats_participant_a_idx ON chats(participant_a);
CREATE INDEX IF NOT EXISTS chats_participant_b_idx ON chats(participant_b);
CREATE UNIQUE INDEX IF NOT EXISTS chats_participants_service_idx ON chats(buyer_id, seller_id, service_id);
CREATE UNIQUE INDEX IF NOT EXISTS chats_participants_pair_idx ON chats(participant_a, participant_b) WHERE participant_a IS NOT NULL AND participant_b IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_chat_id_idx ON messages(chat_id);
CREATE INDEX IF NOT EXISTS chat_reads_user_id_idx ON chat_reads(user_id);
CREATE INDEX IF NOT EXISTS user_locations_gix ON user_locations USING GIST(location);
