-- Seed data for MASTER EYE (demo / offline-capable)

INSERT INTO webcams (ip, port, product, title, city, country, country_code, latitude, longitude, snapshot_url, stream_url, protocol, tags)
VALUES
  ('185.199.108.153', 80, 'webcamxp', 'NYC Midtown Traffic Cam', 'New York', 'United States', 'US', 40.7580, -73.9855,
   'https://picsum.photos/seed/nyc1/640/360', 'https://picsum.photos/seed/nyc1/1280/720', 'http', ARRAY['traffic','urban']),
  ('104.21.16.1', 8080, 'mjpeg', 'LAX Approach Corridor Cam', 'Los Angeles', 'United States', 'US', 33.9425, -118.4081,
   'https://picsum.photos/seed/lax1/640/360', 'https://picsum.photos/seed/lax1/1280/720', 'http', ARRAY['airport','aviation']),
  ('151.101.1.69', 80, 'axis', 'Chicago Loop Skyline', 'Chicago', 'United States', 'US', 41.8781, -87.6298,
   'https://picsum.photos/seed/chi1/640/360', 'https://picsum.photos/seed/chi1/1280/720', 'http', ARRAY['skyline']),
  ('93.184.216.34', 554, 'rtsp', 'Heathrow Perimeter View', 'London', 'United Kingdom', 'GB', 51.4700, -0.4543,
   'https://picsum.photos/seed/lhr1/640/360', 'https://picsum.photos/seed/lhr1/1280/720', 'rtsp', ARRAY['airport']),
  ('142.250.185.78', 80, 'webcamxp', 'Tokyo Bay Harbor Cam', 'Tokyo', 'Japan', 'JP', 35.6528, 139.8395,
   'https://picsum.photos/seed/tyo1/640/360', 'https://picsum.photos/seed/tyo1/1280/720', 'http', ARRAY['harbor','maritime']),
  ('151.101.65.69', 8081, 'foscam', 'SFO Bay Bridge Cam', 'San Francisco', 'United States', 'US', 37.8199, -122.4783,
   'https://picsum.photos/seed/sfo1/640/360', 'https://picsum.photos/seed/sfo1/1280/720', 'http', ARRAY['bridge','traffic']),
  ('104.16.132.229', 80, 'hikvision', 'Dubai Marina Waterfront', 'Dubai', 'United Arab Emirates', 'AE', 25.0805, 55.1403,
   'https://picsum.photos/seed/dxb1/640/360', 'https://picsum.photos/seed/dxb1/1280/720', 'http', ARRAY['marina']),
  ('13.32.92.10', 80, 'dlink', 'Sydney Harbour Lookout', 'Sydney', 'Australia', 'AU', -33.8568, 151.2153,
   'https://picsum.photos/seed/syd1/640/360', 'https://picsum.photos/seed/syd1/1280/720', 'http', ARRAY['harbour']),
  ('23.227.38.65', 8080, 'webcamxp', 'Miami Beach Pier Cam', 'Miami', 'United States', 'US', 25.7907, -80.1300,
   'https://picsum.photos/seed/mia1/640/360', 'https://picsum.photos/seed/mia1/1280/720', 'http', ARRAY['beach']),
  ('151.101.193.69', 80, 'axis', 'Berlin Brandenburg Gate Area', 'Berlin', 'Germany', 'DE', 52.5163, 13.3777,
   'https://picsum.photos/seed/ber1/640/360', 'https://picsum.photos/seed/ber1/1280/720', 'http', ARRAY['landmark']),
  ('104.18.32.7', 80, 'mjpeg', 'JFK Runway 31L Overlay', 'New York', 'United States', 'US', 40.6413, -73.7781,
   'https://picsum.photos/seed/jfk1/640/360', 'https://picsum.photos/seed/jfk1/1280/720', 'http', ARRAY['airport','aviation']),
  ('192.0.66.2', 8080, 'webcamxp', 'Paris CDG Terminal Approach', 'Paris', 'France', 'FR', 49.0097, 2.5479,
   'https://picsum.photos/seed/cdg1/640/360', 'https://picsum.photos/seed/cdg1/1280/720', 'http', ARRAY['airport'])
ON CONFLICT (ip, port) DO UPDATE SET
  title = EXCLUDED.title,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  snapshot_url = EXCLUDED.snapshot_url,
  updated_at = NOW(),
  is_active = TRUE;

INSERT INTO audio_feeds (name, feed_type, description, city, region, country, country_code, latitude, longitude, stream_url, website_url, frequency)
VALUES
  ('KJFK Tower', 'aviation', 'John F. Kennedy International — Tower', 'New York', 'NY', 'United States', 'US', 40.6413, -73.7781,
   'https://s1-fmt2.liveatc.net/kjfk_twr', 'https://www.liveatc.net/search/?icao=KJFK', '119.100'),
  ('KJFK Approach', 'aviation', 'JFK Approach Control', 'New York', 'NY', 'United States', 'US', 40.6500, -73.7900,
   'https://s1-fmt2.liveatc.net/kjfk_app', 'https://www.liveatc.net/search/?icao=KJFK', '125.700'),
  ('KLAX Tower', 'aviation', 'Los Angeles International — Tower', 'Los Angeles', 'CA', 'United States', 'US', 33.9425, -118.4081,
   'https://s1-fmt2.liveatc.net/klax_twr', 'https://www.liveatc.net/search/?icao=KLAX', '133.900'),
  ('EGLL Heathrow Tower', 'aviation', 'London Heathrow — Tower', 'London', 'ENG', 'United Kingdom', 'GB', 51.4700, -0.4543,
   'https://s1-fmt2.liveatc.net/egll_twr', 'https://www.liveatc.net/search/?icao=EGLL', '118.700'),
  ('KSFO Tower', 'aviation', 'San Francisco International — Tower', 'San Francisco', 'CA', 'United States', 'US', 37.6213, -122.3790,
   'https://s1-fmt2.liveatc.net/ksfo_twr', 'https://www.liveatc.net/search/?icao=KSFO', '120.500'),
  ('NYC Metro Police Scanner', 'police', 'New York City metro dispatch relay', 'New York', 'NY', 'United States', 'US', 40.7128, -74.0060,
   'https://broadcastify.cdnstream1.com/1225', 'https://www.broadcastify.com', '460.025'),
  ('LA County Fire Dispatch', 'fire', 'Los Angeles County Fire mutual aid', 'Los Angeles', 'CA', 'United States', 'US', 34.0522, -118.2437,
   'https://broadcastify.cdnstream1.com/18699', 'https://www.broadcastify.com', '154.190'),
  ('Chicago PD Zone 1', 'police', 'Chicago Police Zone 1 scanner', 'Chicago', 'IL', 'United States', 'US', 41.8781, -87.6298,
   'https://broadcastify.cdnstream1.com/14791', 'https://www.broadcastify.com', '460.500'),
  ('RJTT Tokyo Tower', 'aviation', 'Tokyo Haneda — Tower', 'Tokyo', 'Tokyo', 'Japan', 'JP', 35.5494, 139.7798,
   'https://s1-fmt2.liveatc.net/rjtt_twr', 'https://www.liveatc.net/search/?icao=RJTT', '118.100'),
  ('EDDB Berlin Tower', 'aviation', 'Berlin Brandenburg — Tower', 'Berlin', 'BE', 'Germany', 'DE', 52.3667, 13.5033,
   'https://s1-fmt2.liveatc.net/eddb_twr', 'https://www.liveatc.net/search/?icao=EDDB', '118.400'),
  ('Miami-Dade Emergency', 'emergency', 'Miami-Dade County emergency ops', 'Miami', 'FL', 'United States', 'US', 25.7617, -80.1918,
   'https://broadcastify.cdnstream1.com/18111', 'https://www.broadcastify.com', '154.280'),
  ('LFPG CDG Tower', 'aviation', 'Paris Charles de Gaulle — Tower', 'Paris', 'IDF', 'France', 'FR', 49.0097, 2.5479,
   'https://s1-fmt2.liveatc.net/lfpg_twr', 'https://www.liveatc.net/search/?icao=LFPG', '119.250')
ON CONFLICT (name, latitude, longitude) DO UPDATE SET
  stream_url = EXCLUDED.stream_url,
  description = EXCLUDED.description,
  is_active = TRUE,
  updated_at = NOW();

-- Seed Flock / ALPR cameras (demo)
INSERT INTO flock_cameras (
  osm_id, name, manufacturer, model, operator, city, state, country, country_code,
  latitude, longitude, direction, surveillance_type, source, tags, is_active
) VALUES
  ('seed-nyc-1', 'Flock Falcon — Midtown E 42nd', 'Flock Safety', 'Falcon', 'NYPD partner network', 'New York', 'NY', 'United States', 'US', 40.7516, -73.9755, 270, 'ALPR', 'seed', ARRAY['flock','alpr'], TRUE),
  ('seed-nyc-2', 'Flock Falcon — FDR / 34th', 'Flock Safety', 'Falcon', 'NYPD partner network', 'New York', 'NY', 'United States', 'US', 40.7441, -73.9721, 180, 'ALPR', 'seed', ARRAY['flock','alpr'], TRUE),
  ('seed-nyc-3', 'Flock Falcon — Brooklyn Bridge approach', 'Flock Safety', 'Falcon', 'NYPD partner network', 'New York', 'NY', 'United States', 'US', 40.7061, -73.9969, 45, 'ALPR', 'seed', ARRAY['flock','alpr','bridge'], TRUE),
  ('seed-jfk-1', 'Flock Falcon — JFK Van Wyck', 'Flock Safety', 'Falcon', 'Port Authority / LE', 'Queens', 'NY', 'United States', 'US', 40.6586, -73.7956, 0, 'ALPR', 'seed', ARRAY['flock','alpr','airport'], TRUE),
  ('seed-lax-1', 'Flock Falcon — Century / LAX', 'Flock Safety', 'Falcon', 'LAPD partner network', 'Los Angeles', 'CA', 'United States', 'US', 33.9456, -118.3947, 90, 'ALPR', 'seed', ARRAY['flock','alpr','airport'], TRUE),
  ('seed-chi-1', 'Flock Falcon — Loop Wacker', 'Flock Safety', 'Falcon', 'CPD partner network', 'Chicago', 'IL', 'United States', 'US', 41.8865, -87.6368, 180, 'ALPR', 'seed', ARRAY['flock','alpr'], TRUE),
  ('seed-atl-1', 'Flock Falcon — Downtown Peachtree', 'Flock Safety', 'Falcon', 'APD partner network', 'Atlanta', 'GA', 'United States', 'US', 33.7590, -84.3880, 0, 'ALPR', 'seed', ARRAY['flock','alpr'], TRUE),
  ('seed-hou-1', 'Flock Falcon — Downtown Houston', 'Flock Safety', 'Falcon', 'HPD partner network', 'Houston', 'TX', 'United States', 'US', 29.7604, -95.3698, 270, 'ALPR', 'seed', ARRAY['flock','alpr'], TRUE),
  ('seed-mia-1', 'Flock Falcon — Brickell Ave', 'Flock Safety', 'Falcon', 'Miami PD partner', 'Miami', 'FL', 'United States', 'US', 25.7617, -80.1918, 90, 'ALPR', 'seed', ARRAY['flock','alpr'], TRUE),
  ('seed-sea-1', 'Flock Falcon — SODO corridor', 'Flock Safety', 'Falcon', 'SPD partner network', 'Seattle', 'WA', 'United States', 'US', 47.5805, -122.3331, 0, 'ALPR', 'seed', ARRAY['flock','alpr'], TRUE)
ON CONFLICT (osm_id) DO UPDATE SET
  name = EXCLUDED.name,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  is_active = TRUE,
  updated_at = NOW();
