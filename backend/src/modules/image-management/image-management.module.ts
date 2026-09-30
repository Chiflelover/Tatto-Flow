import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminImagesController, ArtistImagesController } from './image-management.controller.js';
import { ImageManagementService } from './image-management.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminImagesController, ArtistImagesController],
  providers: [ImageManagementService],
})
export class ImageManagementModule {}
