classdef ExportMetricsJSONTest < matlab.unittest.TestCase
    methods (TestClassSetup)
        function addExporter(testCase)
            root = fileparts(fileparts(mfilename('fullpath')));
            testCase.applyFixture(matlab.unittest.fixtures.PathFixture(fullfile(root,'matlab')));
        end
    end
    methods (Test)
        function singleSampleRemainsArray(testCase)
            s = ExportMetricsJSONTest.sample();
            s.metrics.AWI = {42};
            s.metrics_time.AWI = {0};
            d = exportMetricsJSON(s, "", Interactive=false);
            encoded = jsonencode(d);
            testCase.verifyTrue(contains(encoded, '"time":[0]'));
            testCase.verifyTrue(contains(encoded, '"values":[42]'));
            testCase.verifyTrue(contains(encoded, '"recordings":['));
        end
        function missingValuesBecomeNull(testCase)
            s = ExportMetricsJSONTest.sample();
            s.metrics.AWI = {[NaN Inf -Inf]};
            d = exportMetricsJSON(s, "", Interactive=false);
            testCase.verifyTrue(contains(jsonencode(d), '"values":[null,null,null]'));
        end
        function rejectsUnsortedTimes(testCase)
            s = ExportMetricsJSONTest.sample();
            s.metrics_time.AWI = {[0 2 1]};
            testCase.verifyError(@() exportMetricsJSON(s,"",Interactive=false), 'MetricsViewer:Times');
        end
        function rejectsLengthMismatch(testCase)
            s = ExportMetricsJSONTest.sample();
            s.metrics.AWI = {[1 2]};
            testCase.verifyError(@() exportMetricsJSON(s,"",Interactive=false), 'MetricsViewer:Dimensions');
        end
        function rejectsDuplicateSubjects(testCase)
            s = ExportMetricsJSONTest.sample();
            testCase.verifyError(@() exportMetricsJSON({s s},"",Interactive=false), 'MetricsViewer:DuplicateSubject');
        end
        function bulkEncodingPreservesExtremeDoublesAndText(testCase)
            s = ExportMetricsJSONTest.sample();
            s.subject = "SBJ ""è"" \A";
            s.metrics.AWI = {[realmax realmin eps(0)]};
            folder = testCase.applyFixture(matlab.unittest.fixtures.TemporaryFolderFixture);
            output = fullfile(folder.Folder,'extremes.json');
            exportMetricsJSON(s,output);
            d = jsondecode(fileread(output));
            testCase.verifyEqual(d.recordings.subject,char(s.subject));
            testCase.verifyEqual(d.recordings.epochs.metrics.AWI.values(:),s.metrics.AWI{1}(:));
        end
        function bulkEncodingPreservesScalarAndEmptyArrays(testCase)
            s = ExportMetricsJSONTest.sample();
            s.epoch_id = ["one" "empty"];
            s.metrics.AWI = {42, []};
            s.metrics_time.AWI = {0, []};
            folder = testCase.applyFixture(matlab.unittest.fixtures.TemporaryFolderFixture);
            output = fullfile(folder.Folder,'arrays.json');
            exportMetricsJSON(s,output);
            encoded = fileread(output);
            testCase.verifyTrue(contains(encoded,'"time":[0],"values":[42]'));
            testCase.verifyTrue(contains(encoded,'"time":[],"values":[]'));
            d = jsondecode(encoded);
            testCase.verifyEqual(d.recordings.epochs(1).metrics.AWI.values,42);
            testCase.verifyEmpty(d.recordings.epochs(2).metrics.AWI.values);
        end
        function bulkEncodingWritesMissingValuesAsNull(testCase)
            s = ExportMetricsJSONTest.sample();
            s.metrics.AWI = {[NaN Inf -Inf]};
            folder = testCase.applyFixture(matlab.unittest.fixtures.TemporaryFolderFixture);
            output = fullfile(folder.Folder,'missing.json');
            exportMetricsJSON(s,output);
            testCase.verifyTrue(contains(fileread(output),'"values":[null,null,null]'));
        end
        function exportsMultipleSubjectsToDisk(testCase)
            s = ExportMetricsJSONTest.sample();
            other = s; other.subject = "SBJ_02";
            folder = testCase.applyFixture(matlab.unittest.fixtures.TemporaryFolderFixture);
            output = fullfile(folder.Folder,'metrics.json');
            exportMetricsJSON({s other},output);
            d = jsondecode(fileread(output));
            testCase.verifyEqual(numel(d.recordings),2);
            testCase.verifyEqual(d.recordings(2).subject,'SBJ_02');
            testCase.verifyFalse(isfield(d.recordings,'Fs'));
        end
    end
    methods (Static)
        function s = sample()
            s = struct('subject',"SBJ_01",'epoch_id',"baseline", ...
                'metrics',struct('AWI',{{[1 2 3]}}), ...
                'metrics_time',struct('AWI',{{[0 .5 1]}}));
        end
    end
end
