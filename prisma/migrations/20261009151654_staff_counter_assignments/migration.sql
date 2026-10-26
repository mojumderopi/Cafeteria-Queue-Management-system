-- CreateTable
CREATE TABLE "StaffCounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffCounter_userId_idx" ON "StaffCounter"("userId");

-- CreateIndex
CREATE INDEX "StaffCounter_counterId_idx" ON "StaffCounter"("counterId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCounter_userId_counterId_key" ON "StaffCounter"("userId", "counterId");

-- AddForeignKey
ALTER TABLE "StaffCounter" ADD CONSTRAINT "StaffCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCounter" ADD CONSTRAINT "StaffCounter_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "Counter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
