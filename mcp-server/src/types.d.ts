declare module "adm-zip" {
  import { ZipFile } from "adm-zip";

  class AdmZip {
    constructor();
    addLocalFolder(folderPath: string): void;
    addLocalFile(filePath: string): void;
    toBuffer(): Buffer;
    writeZip(destFilePath: string): void;
  }

  export default AdmZip;
}
