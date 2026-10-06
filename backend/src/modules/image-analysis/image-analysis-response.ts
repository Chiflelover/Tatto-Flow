export class InvalidImageAnalysisResponseError extends Error {
  constructor() {
    super('The image analysis provider returned an invalid structured response.');
    this.name = InvalidImageAnalysisResponseError.name;
  }
}
