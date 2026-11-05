-- Audio files' waveforms (issue #388): worked out once by the Worker, drawn while the audio loads.
CREATE TABLE "AudioWaveform" (
    "storageKey" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,
    "loudest" DOUBLE PRECISION NOT NULL,
    "peaks" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudioWaveform_pkey" PRIMARY KEY ("storageKey")
);
