export type SubmittedQuestion = {
  questionId: string;
  selectedAnswers: string[];
};

export type SubmittedQuiz = {
  quizId: string;
  participant: {
    uid: string;
    displayName: string;
  };
  questions: SubmittedQuestion[];
};

export type AnswerDoc = {
  questionId: string;
  correctAnswers: string[];
};

export type EvaluateQuizResponse = {
  quizId: string;
  quizTitle: string;
  scoreSum: number;
  participant: {
    uid: string;
    displayName: string;
  };
  questionsEvaluated: QuestionEvaluated[];
  recordParticipation?: boolean;
};

export type QuestionOption = {
  id: string;
  questionText: string;
  type: string;
  availableAnswers: string[];
};

export type QuestionEvaluated = Omit<QuestionOption, "availableAnswers"> & {
  userAttempted: boolean;
  score: number;
  evaluatedOptions: EvaluatedOption[];
};

export type EvaluatedOption = {
  label: string;
  userChecked: boolean;
  correct: boolean;
};
