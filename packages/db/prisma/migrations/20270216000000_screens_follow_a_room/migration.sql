-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "roomId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Screen_resourceId_key" ON "Screen"("resourceId");

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

