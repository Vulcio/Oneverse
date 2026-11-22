# Sync play sends the timeline, never the beat

In sync play (#13) only "beat N at server time T" crosses the network; each device plays the metronome and stems on
its own clock, paired with the server's. Sending each beat would arrive late and unevenly over Wi-Fi; a shared
timeline keeps devices in time whatever the network does, and stays small enough for headless devices.
