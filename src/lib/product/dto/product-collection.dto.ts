export interface CreateProductCollectionDTO {
  title: string;
  handle: string;
  description?: string | null;
  createdBy: string;
  updatedBy: string;
}

export interface ProductCollectionDTO {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductCollectionInsertDTO extends CreateProductCollectionDTO {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateProductCollectionDTO {
  title?: string;
  handle?: string;
  description?: string | null;
  updatedBy: string;
}
